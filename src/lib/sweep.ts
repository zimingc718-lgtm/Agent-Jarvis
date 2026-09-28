import { ENTITIES_ROOT, listEntities, readEntity, type EntitySummary } from "./entities";
import { fetchSource, type FetchSourceDeps } from "./sources";
import type { Store } from "./store";
import { type Coded, withCode, zhMessage } from "./coded-error";
import type { Vars } from "./i18n-core";
import type { ServerMessageKey } from "./i18n-server";

/**
 * Scheduled collection (CR-20260911-scheduled-sweep; 清零 CR-20260911-home-dashboard 出口义务 5 的最后一项).
 *
 * 成本先实测，再定形状（B / C 期的做法）。本机实测一轮 36 个源：
 *
 *   本地处理 289 ms（约 8 ms/源，含抽正文、按行比对、写快照）
 *   快照占用 约 17.9 KB/源
 *   模型 token **0**
 *
 * 那个 0 决定了所有设计。主动唤醒要防的是 token 花销，所以它有日预算；巡检一个
 * 模型调用都没有，日预算在这里是装饰。真正的成本是**别人的服务器**和墙上时间，
 * 所以闸门换成三道：默认关、每轮条数上限、最小间隔。
 *
 * 三个刻意的选择：
 *
 * ① **顺序执行，不并发。** 本地只花 8 ms，等待全在远端；三十几个请求同时打出去，
 *    在对方看来和一次小规模攻击没有区别。一轮只取几个，一个一个来。
 *
 * ② **游标轮转，不按最旧优先。** 采集失败不会推进 `checkedAt`（那个字段记的是「上次
 *    真的学到东西」），所以「最旧优先」会让一个坏掉的源永远排在队首，把别的源饿死。
 *    游标存在 app_settings 里，每轮从上次停的地方往后取，谁也不会被跳过。
 *
 * ③ **从没采集过的对象排在最前。** 卡片上「安静」和「我们根本没在看」长得一样，
 *    而从没采过的对象正处在后一种状态里，它的沉默最容易被误读。
 */

export const SETTING_SWEEP_ENABLED = "sweep.enabled";
export const SETTING_SWEEP_INTERVAL = "sweep.interval_minutes";
export const SETTING_SWEEP_MAX_PER_ROUND = "sweep.max_per_round";
/** Where the last round stopped, so the next one continues instead of restarting. */
export const SETTING_SWEEP_CURSOR = "sweep.cursor";
export const SETTING_SWEEP_LAST_RUN = "sweep.last_run";

export const SWEEP_DEFAULTS = { enabled: false, intervalMinutes: 180, maxPerRound: 6 } as const;
/** Politeness floor: nobody's public page needs to be read more than twice an hour. */
export const SWEEP_INTERVAL_MIN = 30;
export const SWEEP_INTERVAL_MAX = 24 * 60;
export const SWEEP_MAX_PER_ROUND_LIMIT = 20;

export type SweepSettings = { enabled: boolean; intervalMinutes: number; maxPerRound: number };

export class SweepSettingsError extends Error {
  constructor(
    message: string,
    readonly status: 400 = 400
  ) {
    super(message);
    this.name = "SweepSettingsError";
  }

  /** Same Chinese `message` as before, plus the dictionary code a route uses to word it in the interface language (DEC-470 ③). */
  static coded(code: ServerMessageKey, params?: Vars): SweepSettingsError & Coded {
    return withCode(new SweepSettingsError(zhMessage(code, params)), code, params);
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function readSweepSettings(store: Store): SweepSettings {
  return {
    enabled: store.getSetting(SETTING_SWEEP_ENABLED) === "true",
    intervalMinutes: clampInt(store.getSetting(SETTING_SWEEP_INTERVAL), SWEEP_DEFAULTS.intervalMinutes, SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX),
    maxPerRound: clampInt(store.getSetting(SETTING_SWEEP_MAX_PER_ROUND), SWEEP_DEFAULTS.maxPerRound, 1, SWEEP_MAX_PER_ROUND_LIMIT),
  };
}

export function writeSweepSettings(store: Store, input: Partial<SweepSettings>): SweepSettings {
  if (input.enabled !== undefined) {
    store.setSetting(SETTING_SWEEP_ENABLED, String(input.enabled));
  }
  if (input.intervalMinutes !== undefined) {
    const value = Number(input.intervalMinutes);
    if (!Number.isInteger(value) || value < SWEEP_INTERVAL_MIN || value > SWEEP_INTERVAL_MAX) {
      throw SweepSettingsError.coded("sweep.intervalRange", { min: SWEEP_INTERVAL_MIN, max: SWEEP_INTERVAL_MAX });
    }
    store.setSetting(SETTING_SWEEP_INTERVAL, String(value));
  }
  if (input.maxPerRound !== undefined) {
    const value = Number(input.maxPerRound);
    if (!Number.isInteger(value) || value < 1 || value > SWEEP_MAX_PER_ROUND_LIMIT) {
      throw SweepSettingsError.coded("sweep.perRoundRange", { max: SWEEP_MAX_PER_ROUND_LIMIT });
    }
    store.setSetting(SETTING_SWEEP_MAX_PER_ROUND, String(value));
  }
  return readSweepSettings(store);
}

export type SweepTarget = { entity: string; url: string };

/**
 * Every source that is due, in a fixed order.
 *
 * "Due" is per ENTITY, not per source: `checkedAt` lives on the entity, so all of an
 * entity's sources come due together. Never-collected entities come first — their
 * silence is the most misleading thing on the board.
 */
export function dueTargets(entities: EntitySummary[], intervalMinutes: number, now: Date = new Date()): SweepTarget[] {
  const cutoff = now.getTime() - intervalMinutes * 60_000;
  const never: SweepTarget[] = [];
  const stale: SweepTarget[] = [];
  for (const entity of entities) {
    if (entity.sources.length === 0) {
      continue;
    }
    const checked = entity.checkedAt ? new Date(entity.checkedAt).getTime() : Number.NaN;
    const targets = entity.sources.map((url) => ({ entity: entity.name, url }));
    if (!Number.isFinite(checked)) {
      never.push(...targets);
    } else if (checked <= cutoff) {
      stale.push(...targets);
    }
  }
  return [...never, ...stale];
}

/** Rotate the list so it starts just after the cursor; an unknown cursor starts at the top. */
export function rotateAfter(targets: SweepTarget[], cursor: string | null): SweepTarget[] {
  if (!cursor) {
    return targets;
  }
  const index = targets.findIndex((target) => key(target) === cursor);
  if (index < 0) {
    return targets;
  }
  return [...targets.slice(index + 1), ...targets.slice(0, index + 1)];
}

function key(target: SweepTarget): string {
  // 复合键分隔符。字面 NUL 字节曾经直接写在这里——同一个字节让 git 把整个文件判成
  // 二进制（`git ls-files --eol` 看不到它、`grep`/`diff` 静默跳过它），改用转义写法，
  // 字节内容一致，源码里不再有裸控制字符（CR-20260915-process-hardening-flow CP-1）。
  return `${target.entity}\0${target.url}`;
}

export type SweepResult = {
  entity: string;
  url: string;
  health: string;
  changed: boolean;
  change: string;
  detail: string;
};

export type SweepOutcome = {
  ran: boolean;
  /** Why a round did nothing: off, nothing due, or no sources configured at all. */
  reason: string;
  /** Dictionary code + params behind `reason`, so a route can word it in the interface language (DEC-470). */
  reasonCode: ServerMessageKey;
  reasonParams?: Vars;
  results: SweepResult[];
  /** Due but not reached this round — the honest answer to "is that all?" */
  remaining: number;
  at: string;
};

export type SweepDeps = FetchSourceDeps & {
  root?: string;
  store: Store;
  /** Run even when the setting is off (the 「立即巡检一轮」 button is the user's own action). */
  force?: boolean;
};

export async function runSweep(deps: SweepDeps): Promise<SweepOutcome> {
  const root = deps.root ?? ENTITIES_ROOT;
  const now = deps.now ?? (() => new Date());
  const at = now().toISOString();
  const settings = readSweepSettings(deps.store);

  if (!settings.enabled && deps.force !== true) {
    return { ran: false, reason: zhMessage("sweep.disabled"), reasonCode: "sweep.disabled", results: [], remaining: 0, at };
  }

  const entities = await listEntities(root);
  if (entities.every((entity) => entity.sources.length === 0)) {
    return { ran: false, reason: zhMessage("sweep.noSources"), reasonCode: "sweep.noSources", results: [], remaining: 0, at };
  }

  const due = dueTargets(entities, settings.intervalMinutes, now());
  if (due.length === 0) {
    return { ran: false, reason: zhMessage("sweep.nothingDue"), reasonCode: "sweep.nothingDue", results: [], remaining: 0, at };
  }

  const ordered = rotateAfter(due, deps.store.getSetting(SETTING_SWEEP_CURSOR));
  const batch = ordered.slice(0, settings.maxPerRound);

  const results: SweepResult[] = [];
  for (const target of batch) {
    // Sequential on purpose: the local work is 8 ms, the wait is someone else's server.
    // eslint-disable-next-line no-await-in-loop
    const entity = await readEntity(target.entity, root);
    if (!entity || !entity.sources.includes(target.url)) {
      continue; // removed between listing and running; nothing to report
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await fetchSource(target.entity, target.url, { ...deps, root });
      results.push({
        entity: target.entity,
        url: target.url,
        health: outcome.health,
        changed: outcome.changed,
        change: outcome.change,
        detail: outcome.detail,
      });
    } catch (error) {
      results.push({
        entity: target.entity,
        url: target.url,
        health: "failed_fetch",
        changed: false,
        change: "",
        detail: `采集未执行：${error instanceof Error ? error.message : "未知错误"}`,
      });
    }
  }

  if (batch.length > 0) {
    deps.store.setSetting(SETTING_SWEEP_CURSOR, key(batch[batch.length - 1]));
  }
  deps.store.setSetting(SETTING_SWEEP_LAST_RUN, at);

  const changedCount = results.filter((result) => result.changed).length;
  const reasonCode: ServerMessageKey = changedCount > 0 ? "sweep.ranChanged" : "sweep.ranUnchanged";
  const reasonParams = { count: results.length, changed: changedCount };
  return {
    ran: true,
    reason: zhMessage(reasonCode, reasonParams),
    reasonCode,
    reasonParams,
    results,
    remaining: Math.max(0, due.length - batch.length),
    at,
  };
}

export function readLastRun(store: Store): string {
  return store.getSetting(SETTING_SWEEP_LAST_RUN) ?? "";
}
