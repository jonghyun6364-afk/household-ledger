// Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 에서 복사한 값을 붙여넣으세요.
// 이 값들은 공개되어도 괜찮습니다. 데이터 보호는 firestore.rules 가 담당합니다.
export const firebaseConfig = {
  apiKey: "AIzaSyCq58mBov-qy-FpIEkEwu5npe4OwsfEDvY",
  authDomain: "egojin-daegu-inventory.firebaseapp.com",
  projectId: "egojin-daegu-inventory",
  storageBucket: "egojin-daegu-inventory.firebasestorage.app",
  messagingSenderId: "546777120282",
  appId: "1:546777120282:web:c0c90a2b3b7bb3904e5ba3",
};

// 항상 관리자인 계정. firestore.rules 의 OWNER 이메일과 같아야 합니다.
export const OWNER_EMAIL = "jonghyun6364@gmail.com";
