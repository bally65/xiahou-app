/* 蝦猴採集 — 設定檔
 *
 * 要開啟「LINE 登入」:
 *   1. 到 https://developers.line.biz/console/ 建一個 Provider
 *   2. 建一個「LINE Login」channel
 *   3. 在該 channel 下建一個 LIFF app:
 *        - Size: Full
 *        - Endpoint URL: https://bally65.github.io/xiahou-app/
 *        - Scopes: openid, profile
 *   4. 複製 LIFF ID(像 2006xxxxxx-abcdEFGH),貼到下面 liffId
 *
 * liffId 留空字串 = 本機模式(不需登入,目前狀態)。
 */
window.SBCV_CONFIG = {
  liffId: ""          // ← 貼上你的 LIFF ID 即啟用 LINE 登入
};
