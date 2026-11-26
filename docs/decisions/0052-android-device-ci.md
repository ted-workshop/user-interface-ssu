# ADR-0052: 공통 Android 기기 검사를 GitHub 에뮬레이터에서 실행해요

- 상태: 확정
- 작성일: 2026-11-26
- 확정 근거: 사용자가 담당 범위의 남은 작업을 진행하도록 요청했어요. #28·PR #91의 기기 검증을 마무리하기 위한 실행 방법을 판단했어요.
- 관련 기록: [ADR-0051](0051-android-home-summary.md), [ADR-0046](0046-android-report-library.md), [ADR-0011](0011-scoped-quality-checks.md)
- 구현·검증 상태: workflow와 결과 수집을 작성하고 actionlint 1.7.12·YAML·Bash 구문·diff 검사를 통과했어요. 원격 기기 실행·화면 확인은 아직 미검증이에요. 기존 Quality CI 성공과 구분해요.

## 문제와 현재 상태

홈·요약·리포트 기기 시나리오와 캡처 코드는 있지만, 작업 환경에 `/dev/kvm`이 없어요.
소프트웨어 에뮬레이터도 부팅하지 못했고, 개인 Windows 환경의 실행을 기다리면서 PR #91이 Draft로 남아 있어요.

## 결정

- 별도 `Android device` workflow에서 GitHub의 `ubuntu-24.04`와 KVM을 사용해요. Android·도구 버전·이 workflow가 바뀐 PR에서 실행하고, main 반영 뒤에는 수동 실행도 가능해요.
- compile SDK 37.0과 저장소의 JDK·Bun을 유지하고, Pixel 7 형태의 API 35 Google APIs x86_64 에뮬레이터에서 `common` 패키지를 검사해요. 홈·요약, 리포트, 세션·탭 복원과 확인창이 대상이에요.
- `ReportFlowTest`가 전용 주소 이외의 빌드를 건너뛰므로 `qletter.apiBaseUrl=http://127.0.0.1:3000/`을 명시해요. 테스트는 기기 내부 MockWebServer를 사용해요.
- XML에 실패·오류·생략이 있거나 필수 상태 화면 19개가 없으면 실패시켜요. 실패 시에도 로그와 생성된 화면을 수집해요.
- 커밋 SHA·에뮬레이터 버전, 결과 XML·HTML, PNG와 진단 로그를 artifact에 14일 보관해요. 검토에 사용할 화면은 별도로 PR에 첨부해요.
- checkout 자격증명을 저장하지 않고 `contents: read`만 사용해요. 앱 비밀값이나 운영 API를 사용하지 않아요. 기존 필수 `quality` 검사와 별도로 결과를 확인해요.

## 근거와 대안

- [GitHub 실행 환경](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)은 Linux에서 Android 하드웨어 가속을 지원해요(2026-11-26 확인).
- [Android CLI 검사](https://developer.android.com/studio/test/command-line)와 [에뮬레이터 실행](https://developer.android.com/studio/run/emulator-commandline)을 따라 기존 Gradle 시나리오를 실행해요(2026-11-26 확인).
- 개인 기기에서 실행하면 실제 사용 환경을 확인할 수 있지만 사용자의 PC에 의존해요. 이를 대체 완료로 간주하지 않고, 반복 가능한 에뮬레이터 검증을 먼저 확보해요.
- 로컬 소프트웨어 에뮬레이션 재시도는 이미 부팅 실패가 확인됐어요. 유료 기기 서비스·별도 공급자 계정 대신 기존 GitHub 작업 흐름에서 실행해요.
- API 35는 현재 앱의 지원 범위 안에서 UI·세션·상태 전이를 검증하기 위한 선택이에요. API 37의 로컬 네트워크 권한 분기는 별도로 검증해야 해요.

## 가정·한계와 영향

추가 workflow는 Android 변경마다 최대 25분의 runner 사용량을 더해요. 같은 PR의 새 실행은 이전 실행을 취소해요.
소스에 고정한 action SHA를 사용하지만 에뮬레이터와 시스템 이미지의 패치 버전은 SDK 저장소에 따라 달라질 수 있어 실행 버전을 함께 남겨요.
실제 Gemini 요약·Gmail 수신, TalkBack 청취, 개인 기기와 API 37 검증, 팀 리뷰·머지는 완료로 표시하지 않아요.
다른 담당자의 계정·채널·모음·댓글 구현은 변경하지 않아요.

## 검증과 재검토 조건

workflow 구문·shell·경로를 확인하고, 원격 실행에서 공통 테스트가 생략 없이 통과하며 PNG가 실제 화면인지 확인해요.
기기 테스트의 실패는 원인을 확인한 뒤 담당 범위에서 수정해요. 성공으로 만들기 위한 테스트 삭제·생략은 하지 않아요.
실행 시간이 제한을 넘거나 API 37 기기 검증이 필요하면 시스템 이미지·실행 범위를 다시 판단해요.

## 반론과 변경 이력

- 2026-11-26: 새 리뷰 요청은 없지만 기기 검증이 남아 있음을 확인하고 실행 환경을 추가했어요. 실행 전이므로 기기 완료 조건은 미체크로 유지해요.
- 2026-11-26: `161b93a`의 전체 Quality 검사에서 API·Android·Infra가 통과했어요. 최초 기기 실행은 Ubuntu runner의 `libpulse.so.0` 누락으로 에뮬레이터 버전 확인 중 종료됐어요([실행 로그](https://github.com/ted-workshop/user-interface-ssu/actions/runs/45751841794)). 소리를 끄는 옵션과 별개로 실행 파일이 필요한 라이브러리여서 `libpulse0` 설치를 추가했어요. 앱 기기 테스트는 아직 시작되지 않았어요.
