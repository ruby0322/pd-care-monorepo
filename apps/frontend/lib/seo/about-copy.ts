export type AboutFaq = {
  question: string;
  answer: string;
};

export const ABOUT_TITLE = "臺大醫院腹膜透析智慧照護";

export const ABOUT_DESCRIPTION =
  "臺大醫院腹膜透析中心與臺大資管系合作的智慧醫療系統，協助病患以 LINE 每日拍攝出口影像；AI 輔助感染偵測，結果不構成診斷。";

export const ABOUT_LEAD =
  "PD Care 為臺大醫院腹膜透析中心與國立臺灣大學資訊管理學系合作研發之智慧醫療系統，供本院腹膜透析病患使用。病患得透過 LINE 每日拍攝導管出口影像；系統之人工智慧模組可標示需優先檢視之影像，結果僅供照護團隊參考，不構成診斷。";

export const ABOUT_FUNCTION_HEADING = "系統功能";

export const ABOUT_WHAT_IT_DOES =
  "本系統提供導管出口影像之每日蒐集、儲存與回溯，並由護理人員於後台審核。人工智慧輸出作為分級提示，用以協助安排檢視優先順序，不得取代門診評估或臨床判斷。";

export const ABOUT_AFFILIATION_HEADING = "研發單位";

export const ABOUT_WHO_BUILT_IT =
  "研發單位為臺大醫院腹膜透析中心與國立臺灣大學資訊管理學系。病患上傳之出口影像進入透析室既有照護流程。本系統相關技術已取得中華民國專利 M678111「腹膜透析智慧辨識系統」。";

export const ABOUT_HISTORY_HEADING = "研發沿革";

export const ABOUT_HISTORY_BEFORE_CITATION =
  "導管出口感染之研判仰賴臨床觀察，模型訓練則需可標註之高品質出口影像。臺大醫院腹膜透析中心護理師鄭靜誼帶領研究團隊，於照護現場蒐集臨床影像，完成影像輔助風險評估之可行性驗證，並將初步成果發表於";

export const ABOUT_HISTORY_CITATION = {
  href: "https://academic.oup.com/ndt/article/40/Supplement_3/gfaf116.1582/8295727",
  label: "Nephrology Dialysis Transplantation",
} as const;

export const ABOUT_HISTORY_AFTER_CITATION = "。";

export const ABOUT_HISTORY_COLLAB =
  "其後，腹膜透析中心與國立臺灣大學資訊管理學研究所進行產學合作。在所長盧信銘教授督導下，由碩士班研究生顧寬証進行更完整之模型訓練，並將人工智慧模組整合至透析室既有工作流程。";

export const ABOUT_HISTORY_TODAY =
  "現行系統以 LINE LIFF 建置，並整合於臺大醫院腹膜透析中心官方帳號。病患由官方帳號選單進入後完成身分帶入，無須另行登入，即可進行拍攝與上傳，並由護理人員於原照護流程中檢視。";

export const ABOUT_FAQ_HEADING = "常見問題";

export const ABOUT_LINKS_HEADING = "相關連結";

export const ABOUT_FAQS: AboutFaq[] = [
  {
    question: "PD Care 是什麼？",
    answer:
      "PD Care 供本院腹膜透析病患每日拍攝導管出口影像，使照護團隊於兩次回診之間掌握出口變化。人工智慧模組可標示需優先檢視之影像，結果不構成診斷。",
  },
  {
    question: "與臺大醫院、國立臺灣大學資訊管理學系之關係為何？",
    answer:
      "PD Care 為臺大醫院腹膜透析中心與國立臺灣大學資訊管理學系合作研發之專案，供本院腹膜透析病患使用，並非院外消費型應用程式。",
  },
  {
    question: "病患如何使用本系統？",
    answer:
      "病患經由臺大醫院腹膜透析中心 LINE 官方帳號進入本系統，完成身分綁定並經核可後，得每日拍攝出口影像。操作說明見本站「最新消息」。",
  },
  {
    question: "人工智慧結果是否為診斷？",
    answer:
      "否。系統輸出僅供照護團隊參考。若出口紅腫、疼痛、出現分泌物，或有身體不適，應依透析室既有流程聯繫醫療人員，不得以系統結果取代就醫判斷。",
  },
];
