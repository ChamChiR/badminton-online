# 서로 다른 집에서 온라인 배드민턴 1대1 하기

## Render로 서버 배포
1. 이 폴더의 파일을 GitHub의 새 저장소 루트에 업로드합니다 (`server.js`, `index.html`, `package.json`, `render.yaml`).
2. https://dashboard.render.com 에 가입하거나 로그인합니다.
3. **New > Web Service** 에서 GitHub 저장소를 연결합니다. `render.yaml`을 사용하는 **New > Blueprint** 방식도 가능합니다.
4. Web Service 직접 생성 시 Runtime: **Node**, Build Command: `npm install`, Start Command: `npm start` 를 설정합니다. 무료 플랜을 선택할 수 있으면 선택합니다.
5. 배포가 완료되면 Render에서 제공한 `https://...onrender.com` 주소를 복사합니다.
6. 나와 친구가 **같은 HTTPS 주소**를 열고, 한 사람은 '방 만들기', 다른 사람은 방 코드를 입력해 입장합니다.

## 알아둘 점
- 서버는 배포 완료 후 계속 실행되는 외부 서비스입니다. HTML 파일만 친구에게 보내서는 다른 집에서 온라인 대전할 수 없습니다.
- 무료 플랜의 가용성/정책은 바뀔 수 있으며 유휴 상태에서 잠들었다가 첫 접속이 느릴 수 있습니다.
- 이 게임은 **단일 서버 프로세스의 메모리**에 방과 점수를 보관합니다. 서버 재시작 시 방/경기 상태가 초기화됩니다.
- 테스트용 온라인 시제품으로, 기존 AI 버전의 고급 애니메이션/충돌 판정은 아직 완전히 합쳐지지 않았습니다.
- 접속이 안 되면 Render Logs에서 `Badminton online` 출력과 빌드 오류를 확인하세요.
