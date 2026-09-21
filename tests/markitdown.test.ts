import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-510 — `src/lib/markitdown.ts`（DEC-390，CR-20260921-markitdown-display）.
 *
 * `execFile` is fully mocked — no real Python/markitdown subprocess runs here, matching
 * the project's established pattern for external-boundary code (`web-reading.test.ts`'s
 * injectable `fetcher`/`launcher`): unit tests assert the wrapper's own logic (argument
 * shape, error-classification, retry-on-notfound), real conversion quality is a real-entry
 * concern verified against a real document, not something a mock can prove.
 */

type ExecFileCallback = (
  error: (Error & { killed?: boolean; signal?: string; code?: string }) | null,
  stdout: Buffer,
  stderr: Buffer
) => void;

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const { execFile } = await import("node:child_process");
const { convertToHtml, describeMarkitdownFailure } = await import("@/lib/markitdown");

function mockExecFileOnce(
  impl: (file: string, args: readonly string[], options: unknown, callback: ExecFileCallback) => void
) {
  vi.mocked(execFile).mockImplementationOnce(impl as never);
}

beforeEach(() => {
  vi.mocked(execFile).mockReset();
});

afterEach(() => {
  vi.mocked(execFile).mockReset();
});

describe("convertToHtml", () => {
  it("① 成功：把子进程 stdout 当 UTF-8 解码后原样作为 html 返回", async () => {
    mockExecFileOnce((_file, args, _options, callback) => {
      expect(args[args.length - 1]).toContain("test.pdf");
      callback(null, Buffer.from("<h1>你好</h1>", "utf-8"), Buffer.alloc(0));
    });
    const result = await convertToHtml("/tmp/test.pdf");
    expect(result).toEqual({ ok: true, html: "<h1>你好</h1>" });
  });

  it("② Python 解释器不存在（ENOENT）时依次尝试下一个候选名，都不存在则如实报告", async () => {
    mockExecFileOnce((_file, _args, _options, callback) => {
      const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      callback(err, Buffer.alloc(0), Buffer.alloc(0));
    });
    mockExecFileOnce((_file, _args, _options, callback) => {
      const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      callback(err, Buffer.alloc(0), Buffer.alloc(0));
    });
    const result = await convertToHtml("/tmp/test.pdf");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason.startsWith("notfound:")).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("③ 第一个候选解释器真实存在但转换失败：不再尝试第二个候选（失败原样上报，不被掩盖）", async () => {
    mockExecFileOnce((_file, _args, _options, callback) => {
      const err = Object.assign(new Error("Command failed"), {});
      callback(err, Buffer.alloc(0), Buffer.from("markitdown conversion failed: corrupt pdf", "utf-8"));
    });
    const result = await convertToHtml("/tmp/test.pdf");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("corrupt pdf");
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("④ 超时（killed / SIGTERM）分类为 timeout，而不是原样透出 exec 错误文本", async () => {
    mockExecFileOnce((_file, _args, _options, callback) => {
      const err = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" });
      callback(err, Buffer.alloc(0), Buffer.alloc(0));
    });
    const result = await convertToHtml("/tmp/test.pdf", 1_000);
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("⑤ 转换成功但输出为空：视为失败（不能把空字符串当有效 HTML 返回给浏览器）", async () => {
    mockExecFileOnce((_file, _args, _options, callback) => {
      callback(null, Buffer.from("   \n", "utf-8"), Buffer.alloc(0));
    });
    const result = await convertToHtml("/tmp/test.pdf");
    expect(result).toEqual({ ok: false, reason: "empty" });
  });
});

describe("describeMarkitdownFailure", () => {
  it("⑥ 每种失败原因映射到一句面向用户的中文说明，从不原样透出内部 reason 字符串", () => {
    expect(describeMarkitdownFailure("notfound:python3")).not.toContain("notfound");
    expect(describeMarkitdownFailure("timeout")).toContain("超时");
    expect(describeMarkitdownFailure("empty")).toContain("空");
    expect(describeMarkitdownFailure("exec:some raw stderr text")).not.toContain("some raw stderr text");
  });
});
