import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    /**
     * 5 秒的默认值是一句关于机器速度的断言，不是关于正确性的断言。
     *
     * 八个测试文件开的是真 SQLite；整套并发跑满、机器上还有别的会话在编译时，单条用例
     * 到两秒是常态。此前按文件逐个提超时（compaction、display），结果抖动换个文件继续
     * 出现——一次 `verify:all` 里 27 条红、却一条断言错误都没有，隔离重跑 689 全绿。
     *
     * 所以提到配置层：20 秒对真正挂死的用例仍然是及时的失败，对忙机器上的慢用例则不再
     * 是假阳性。挂死要靠「跑不完」暴露，不该靠一个和负载有关的秒数来暴露。
     */
    testTimeout: 20_000
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
