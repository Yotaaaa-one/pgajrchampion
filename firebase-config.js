/*
  Jr Team Score v2.0 Firebase設定
  1) Firebase ConsoleでWebアプリを追加
  2) 下の値をFirebase configに差し替え
  3) enabled を true に変更
*/
window.JR_FIREBASE_CONFIG = {
  enabled: true,
  apiKey: "AIzaSyDf7ueBnF439RI1h5tBW-sABgx7sby3qv4",
  authDomain: "pgajr2026-s.firebaseapp.com",
  projectId: "pgajr2026-s",
  storageBucket: "pgajr2026-s.firebasestorage.app",
  messagingSenderId: "320439439962",
  appId: "1:320439439962:web:0eecde39299f0034093e63"
};

// 大会ごとに変更してください。例：junior2026, junior2027
window.JR_TOURNAMENT_ID = "junior2026";

// Firestore保存先： junior_tournaments/{JR_TOURNAMENT_ID}
window.JR_FIRESTORE_COLLECTION = "junior_tournaments";
