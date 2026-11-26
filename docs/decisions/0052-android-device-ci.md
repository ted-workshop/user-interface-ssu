# ADR-0052: 공통 Android 기기 검사를 GitHub 에뮬레이터에서 실행해요

- 상태: 확정
- 작성일: 2026-11-26
- 확정 근거: 사용자가 담당 범위의 남은 작업을 진행하도록 요청했어요. #28·PR #91의 기기 검증을 마무리하기 위한 실행 방법을 판단했어요.
- 관련 기록: [ADR-0051](0051-android-home-summary.md), [ADR-0046](0046-android-report-library.md), [ADR-0011](0011-scoped-quality-checks.md)
- 구현·검증 상태: `2946af5`의 전체 Quality와 API 35 기기 검사 16개가 실패·오류·생략 없이 통과했어요. PNG 19개 수집을 확인했으며, 홈·요약 9개와 리포트 10개의 검토용 화면을 직접 확인했어요. 홈 오류의 단색 캡처도 해결했어요. 후속 `ff72397` 실행에서 launcher ANR을 확인해 부팅 준비를 수정했으며, 수정 후 검증 결과는 PR #91의 최종 HEAD 검사에 기록해요. API 37·개인 기기·실제 공급자 검증은 남아 있어요.

## 문제와 현재 상태

홈·요약·리포트 기기 시나리오와 캡처 코드는 있지만, 작업 환경에 `/dev/kvm`이 없어요.
작업을 시작할 때는 소프트웨어 에뮬레이터도 부팅하지 못했고, 개인 Windows 환경의 실행을 기다리면서 PR #91이 Draft로 남아 있었어요.

## 결정

- 별도 `Android device` workflow에서 GitHub의 `ubuntu-24.04`와 KVM을 사용해요. Android·도구 버전·이 workflow가 바뀐 PR에서 실행하고, main 반영 뒤에는 수동 실행도 가능해요.
- compile SDK 37.0과 저장소의 JDK·Bun을 유지하고, Pixel 7 형태의 API 35 Google APIs x86_64 에뮬레이터에서 `common` 패키지를 검사해요. 홈·요약, 리포트, 세션·탭 복원과 확인창이 대상이에요.
- `ReportFlowTest`가 전용 주소 이외의 빌드를 건너뛰므로 `qletter.apiBaseUrl=http://127.0.0.1:3000/`을 명시해요. 테스트는 기기 내부 MockWebServer를 사용해요.
- XML에 실패·오류·생략이 있거나 필수 상태 화면 19개가 없으면 실패시켜요. 실패 시에도 로그와 생성된 화면을 수집해요.
- `android.injected.androidTest.leaveApksInstalledAfterRun=true`로 검사 후 APK를 유지해 캡처를 가져와요. 수집이 끝나면 임시 에뮬레이터를 종료해요.
- 부팅 완료 뒤 키 이벤트를 보내지 않고 `svc power stayon true`와 `wm dismiss-keyguard`로 화면 켜짐과 잠금 해제를 준비해요. launcher가 아직 포커스를 얻지 못했을 때 입력 대기 ANR이 생기는 경로를 피해야 해요.
- 커밋 SHA·에뮬레이터 버전, 결과 XML·HTML, PNG와 진단 로그를 artifact에 14일 보관해요. 검토에 사용할 화면은 별도로 PR에 첨부해요.
- checkout 자격증명을 저장하지 않고 `contents: read`만 사용해요. 앱 비밀값이나 운영 API를 사용하지 않아요. 기존 필수 `quality` 검사와 별도로 결과를 확인해요.

## 근거와 대안

- [GitHub 실행 환경](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)은 Linux에서 Android 하드웨어 가속을 지원해요(2026-11-26 확인).
- [Android CLI 검사](https://developer.android.com/studio/test/command-line)와 [에뮬레이터 실행](https://developer.android.com/studio/run/emulator-commandline)을 따라 기존 Gradle 시나리오를 실행해요(2026-11-26 확인).
- [AGP 옵션 정의](https://android.googlesource.com/platform/tools/base/+/77b69cf85219f333699ba865d83ad999cbd8e077/build-system/gradle-core/src/main/java/com/android/build/gradle/options/BooleanOption.kt)에서 검사 뒤 APK 삭제가 기본값임을 확인했어요. 앱 외부 파일의 캡처를 수집해야 하므로 이 실행에만 APK 유지 옵션을 사용해요(2026-11-26 확인).
- AOSP의 [PowerCommand](https://android.googlesource.com/platform/frameworks/base/+/master/cmds/svc/src/com/android/commands/svc/PowerCommand.java)와 [WindowManagerShellCommand](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/wm/WindowManagerShellCommand.java)에서 화면 켜짐 유지와 잠금 해제 명령을 확인했어요(2026-11-26). 임시 CI 에뮬레이터에만 적용하며 앱의 ANR 감지나 테스트 실패 판정을 끄지 않아요. 실패 실행을 단순 재시도하는 대신 관찰된 입력 원인을 제거해요.
- 홈·요약 캡처는 화면 문구 확인과 main thread idle 뒤에도 시작 창이 덮여 있을 수 있어요. 시스템 표시줄을 제외한 앱 영역이 단색이면 최대 5초 동안 캡처만 다시 시도하고, 계속 단색이면 검사를 실패시켜요. 파일 존재와 실제 상태는 별도로 시각 확인해요.
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
- 2026-11-26: `d312031`에서 공통 테스트 16개와 전체 Quality가 통과했어요. 다만 검사 후 앱 파일 경로가 없어 필수 화면 19개 수집이 실패했어요([실행 로그](https://github.com/ted-workshop/user-interface-ssu/actions/runs/45752133098)). AGP의 기본 APK 삭제 동작을 확인해 유지 옵션을 추가했어요. 화면 누락 검사는 그대로 두고 재실행해요.
- 2026-11-26: `0a2cf4a`의 [기기 실행](https://github.com/ted-workshop/user-interface-ssu/actions/runs/45753122901)에서 16개 통과·생략 0개와 PNG 19개 수집을 확인했어요. 이미지를 열어 보니 홈 오류는 첫 창 전환 중에 캡처됐고, 리포트 상세의 기존 fixture가 #90 댓글 응답을 제공하지 않았어요. 오류 문구가 보이는지 확인하고 화면 안정 후 캡처하도록 바꿨어요. 리포트 검사의 닉네임·댓글 응답과 모음 로딩 종료 대기도 현재 계약에 맞췄어요. 다른 담당자의 기능 구현은 바꾸지 않았어요.
- 2026-11-26: `fc437f1`의 [기기 실행](https://github.com/ted-workshop/user-interface-ssu/actions/runs/45754132092)에서 16개와 전체 Quality가 다시 통과했고, 댓글·모음 화면도 확인했어요. 홈 오류는 여전히 단색이었어요. logcat의 캡처 시각(04:19:45.917 UTC) 뒤에 시작 창 제거(04:19:46.129 UTC)가 기록돼, 접근성 idle 대기만으로는 시작 창 종료를 보장하지 못함을 확인했어요. 이 대기 대신 단색 캡처를 거부하고 제한 시간 안에서 다시 캡처해요. 앱 요청·검사 결과를 재시도하거나 성공으로 바꾸지는 않아요.
- 2026-11-26: `2946af5`의 [기기 실행](https://github.com/ted-workshop/user-interface-ssu/actions/runs/45755187642)이 3분 52초에 성공했어요. 공통 검사 16개, 실패·오류·생략 0개, 필수 PNG 19개를 확인했어요. 홈 오류에서 안내 문구와 새로고침 버튼이 실제 캡처에 표시됐어요. PR 첨부 화면은 이 실행의 홈·요약 9개와 앞선 `fc437f1` 실행의 리포트 10개예요. 두 실행 사이 제품 코드는 동일하며, 캡처 검사와 기록만 바뀌었어요. [전체 Quality](https://github.com/ted-workshop/user-interface-ssu/actions/runs/45755187713)도 API·Android·Infra·quality가 모두 통과했어요.
- 2026-11-26: 기록만 추가한 `ff72397`의 [기기 실행](https://github.com/ted-workshop/user-interface-ssu/actions/runs/45755818401)은 16개 중 11개가 `RootViewWithoutFocusException`으로 실패했어요. logcat에는 앱 실행 전 launcher의 입력 포커스 대기와 ANR, 시스템 오류창 생성이 순서대로 남아 있었어요(04:34:15~22 UTC). 부팅 직후 `input keyevent 82`가 아직 준비되지 않은 launcher로 전달된 것으로 판단해 키 입력을 제거하고 시스템 명령으로 화면을 준비해요. 이 실행의 실패는 보존하고 동일한 16개 시나리오와 19개 화면 조건으로 다시 검사해요.
