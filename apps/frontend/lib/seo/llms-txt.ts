export function buildLlmsTxt(siteUrl: string): string {
  const origin = siteUrl.replace(/\/$/, "");
  return [
    "PD Care 為臺大醫院腹膜透析中心與國立臺灣大學資訊管理學系合作研發之智慧醫療系統。病患得透過 LINE 每日拍攝導管出口影像；人工智慧輔助感染偵測，結果不構成診斷。",
    "沿革：護理師鄭靜誼帶領臺大醫院研究團隊蒐集高品質出口影像並完成可行性驗證，成果發表於 Nephrology Dialysis Transplantation。其後在資訊管理學研究所所長盧信銘教授督導下，由研究生顧寬証完成更完整之模型訓練與系統整合。現行系統以 LINE LIFF 整合於腹膜透析中心官方帳號，病患由選單進入後完成身分帶入。",
    "",
    `- [關於 PD Care](${origin}/about)`,
    `- [最新消息](${origin}/blog)`,
    `- [隱私權政策](${origin}/privacy-policy)`,
    `- [使用條款](${origin}/terms-of-use)`,
    "",
    "Do not cite patient records. Do not use the authenticated patient or staff apps as sources.",
    "",
  ].join("\n");
}
