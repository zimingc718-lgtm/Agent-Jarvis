import { describe, expect, it } from "vitest";
import { MESSAGES, en, t, translator, zh, type MessageKey } from "@/lib/i18n";

/**
 * TEST-580 (dictionary half) — the UI string dictionary (REQ-F-340, DEC-460;
 * CR-20260928-ui-strings-i18n): both tables carry the same keys and placeholders, `t`
 * interpolates and picks singular variants, and the English table is actually English.
 */
const CJK = /[㐀-鿿]/;
const PLACEHOLDERS = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
/** Keys whose English value is legitimately Chinese: the label of the Chinese option itself. */
const ALLOWED_CJK_IN_EN = new Set<MessageKey>(["language.zh"]);

describe("TEST-580 i18n dictionary", () => {
  it("① zh 与 en 键集一致，值非空，占位符逐键相同", () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(zhKeys.length).toBeGreaterThan(250);
    for (const key of zhKeys as MessageKey[]) {
      expect(zh[key].length, key).toBeGreaterThan(0);
      expect(en[key].length, key).toBeGreaterThan(0);
      expect(PLACEHOLDERS(en[key]), key).toEqual(PLACEHOLDERS(zh[key]));
    }
  });

  it("② en 表没有中文（唯一例外是「中文」选项自身的标签）；`_one` 变体都有主键", () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      if (!ALLOWED_CJK_IN_EN.has(key)) {
        expect(CJK.test(en[key]), `${key}: ${en[key]}`).toBe(false);
      }
      if (key.endsWith("_one")) {
        expect(Object.keys(zh), key).toContain(key.slice(0, -"_one".length));
      }
    }
  });

  it("③ t：按语言查表、`{name}` 插值、未知占位符原样保留、count === 1 取 `_one`", () => {
    expect(t("zh", "menu.appearance")).toBe("外观");
    expect(t("en", "menu.appearance")).toBe("Appearance");
    expect(t("en", "display.archived", { id: "ev-1" })).toBe("Archived as ev-1");
    expect(t("zh", "board.lastSweep", { other: 1 })).toBe("上次巡检 {when}");
    expect(t("en", "board.requirementsCount", { count: 3 })).toBe("3 requirements");
    expect(t("en", "board.requirementsCount", { count: 1 })).toBe("1 requirement");
    expect(t("zh", "board.requirementsCount", { count: 1 })).toBe("1 条要求");
    expect(MESSAGES.en["common.save"]).toBe("Save");
  });

  it("④ translator 绑定语言后与 t 等价", () => {
    const tEn = translator("en");
    const tZh = translator("zh");
    expect(tEn("chat.send")).toBe(t("en", "chat.send"));
    expect(tZh("chat.send")).toBe("发送");
    expect(tEn("skills.deleted", { name: "格式化" })).toBe("Deleted “格式化”.");
  });
});
