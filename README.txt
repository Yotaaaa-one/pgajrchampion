PGAジュニア チーム戦スコア速報ターミナル v2.0
Firebaseリアルタイム同期対応版

【今回の目的】
各組に1台ずつ渡すスコアラー端末、本部端末、一般端末をFirebase Firestoreで接続し、入力内容をリアルタイム共有するための試験版です。

【基本運用】
1. setup.html で大会・チーム・選手・ペアを設定
2. 各端末で device_setup.html を開き、担当組または順位決定戦MATCHを固定
3. 選手・担当者は scorer.html で1ホールごとにスコア入力
4. 本部は hq_status.html で入力状況を確認
5. round1_result.html / final_result.html が速報・成績表として更新

【重要】
2日間とも入力するのは18ホールのスコアのみです。
2日目のポイントは、スコアから自動計算します。
勝ちホール 3pt / 分け 1pt / 負け 0pt

【Firebase設定】
firebase-config.js を開き、Firebase ConsoleのWebアプリ設定を貼り付けてください。

変更前：
  enabled: false,

変更後：
  enabled: true,

あわせて、apiKey / authDomain / projectId / storageBucket / messagingSenderId / appId を入力してください。
大会IDは window.JR_TOURNAMENT_ID で変更できます。
例：junior2026

【Firestore保存先】
junior_tournaments/{JR_TOURNAMENT_ID}

【Firebase未設定時】
Firebase設定が未入力の場合は、これまで通り各ブラウザ内のローカル保存で動きます。
この場合、端末間の同期はされません。

【v2.0で追加されたこと】
・Firebase Firestore接続
・データ保存時にFirestoreへ書き込み
・Firestore更新を各画面にリアルタイム反映
・同期状態表示
・firebase-config.js追加
・本部状況、スコアラー端末、成績表の自動更新

【注意】
このv2.0は実機同期テスト用です。
本番運用前には、Firebase Rules、ログイン、端末固定の重複防止、編集ロックを追加するのがおすすめです。
