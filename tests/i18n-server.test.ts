import { describe, expect, it } from "vitest";
import { isCoded, messageFor, withCode } from "@/lib/coded-error";
import { EntityError } from "@/lib/entities";
import { SERVER_MESSAGES, enServer, serverTranslator, tServer, zhMessage, zhServer, type ServerMessageKey } from "@/lib/i18n-server";
import { ZipError } from "@/lib/zip";

/**
 * TEST-590 — the server dictionary and coded errors (REQ-F-350, DEC-470; CR-20260928-server-strings-i18n):
 * both tables carry the same keys and placeholders, `tServer` words a key per language, a coded
 * error keeps its Chinese `message` while a route can reword it, and non-coded errors pass through.
 */
const CJK = /[㐀-鿿]/;
const PLACEHOLDERS = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("TEST-590 server dictionary", () => {
  it("① zh 与 en 键集一致、值非空、占位符逐键相同；en 无中文", () => {
    const zhKeys = Object.keys(zhServer).sort();
    expect(Object.keys(enServer).sort()).toEqual(zhKeys);
    expect(zhKeys.length).toBeGreaterThan(150);
    for (const key of zhKeys as ServerMessageKey[]) {
      expect(zhServer[key].length, key).toBeGreaterThan(0);
      expect(enServer[key].length, key).toBeGreaterThan(0);
      expect(PLACEHOLDERS(enServer[key]), key).toEqual(PLACEHOLDERS(zhServer[key]));
      expect(CJK.test(enServer[key]), `${key}: ${enServer[key]}`).toBe(false);
    }
    expect(SERVER_MESSAGES.zh).toBe(zhServer);
  });

  it("② tServer / serverTranslator / zhMessage：按语言查表并插值", () => {
    expect(tServer("zh", "api.missingUrl")).toBe("缺少 url。");
    expect(tServer("en", "api.missingUrl")).toBe("Missing url.");
    expect(tServer("en", "api.entityNotFound", { name: "维谛" })).toBe("No tracked entity named “维谛”.");
    expect(serverTranslator("en")("sweep.ranChanged", { count: 3, changed: 1 })).toBe("Collected 3 sources; 1 changed.");
    expect(zhMessage("sweep.ranChanged", { count: 3, changed: 1 })).toBe("采集 3 个源，其中 1 个有变化。");
  });

  it("③ coded 错误：message 仍是原来的中文句子，code + params 让路由能改用英文成句", () => {
    const error = EntityError.coded("entity.tooManyParams", { max: 40 }, 409);
    expect(error).toBeInstanceOf(EntityError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("一个对象最多 40 条参数，请先清理。");
    expect(isCoded(error)).toBe(true);
    expect(messageFor(serverTranslator("en"), error)).toBe("An entity can hold at most 40 parameters; remove some first.");
    expect(messageFor(serverTranslator("zh"), error)).toBe(error.message);

    const zip = ZipError.coded("zip.unsafeParent", { name: "../x" });
    expect(zip.message).toBe("压缩包内路径不安全（上级目录引用）：../x");
    expect(messageFor(serverTranslator("en"), zip)).toBe("Unsafe path inside the archive (parent directory reference): ../x");
  });

  it("④ 非 coded 错误原样透出；无 message 时用 fallback；withCode 可给任意错误加码", () => {
    const t = serverTranslator("en");
    expect(messageFor(t, new Error("原样"))).toBe("原样");
    expect(messageFor(t, new Error(""), "api.archiveFailed")).toBe("Archive failed.");
    expect(messageFor(t, "nope", "api.archiveFailed")).toBe("Archive failed.");
    expect(isCoded(new Error("x"))).toBe(false);
    const coded = withCode(new Error("legacy"), "api.badJson");
    expect(messageFor(t, coded)).toBe("The request body is not valid JSON.");
  });
});
