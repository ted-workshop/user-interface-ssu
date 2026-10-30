# Qletter

YouTube 영상을 읽기 쉬운 한국어 리포트로 만드는 Android 팀프로젝트예요.

현재는 **팀 개발 환경과 Android debug 앱 ↔ 로컬 API 연결**을 제공해요. 회원가입·로그인·Gemini 요약·보관함은 다음 기능 단계예요. 제품 로그인은 이메일·비밀번호 방식이에요.

| 경로 | 역할 |
| --- | --- |
| apps/api | Workers·TypeScript·Hono API와 로컬 D1 |
| apps/android | Java·XML Views Android 앱 |
| infra | Terraform으로 관리할 D1·Worker 생성·R2 state 정의 |
| docs/qletter | 제품 기획·화면 흐름·개발 설계 |
| docs/decisions | 선택의 이유·대안·근거·재검토 조건 |
| scripts, .githooks | 공통 검사와 Git hooks |

## 시작하기

[mise](https://mise.jdx.dev/)와 Git을 설치한 뒤 저장소 루트에서 실행해요.

```sh
mise trust
mise install
mise run setup
mise run api:dev
```

Android SDK를 준비하고 Android Studio에서 **apps/android**를 열어요. debug 앱의 연결 확인 버튼으로 로컬 API를 확인할 수 있어요. 자세한 JDK·SDK·에뮬레이터 설정은 [개발 가이드](docs/development.md)를 따라요.

```sh
mise run api:check
mise run android:check
mise run infra:check
mise run check
```

- [제품 요구사항](docs/qletter/01-prd.md)
- [API 작업 목록과 팀 참여](https://github.com/ted-workshop/user-interface-ssu/issues/2)
- [서버 구조와 기술 선택의 근거](docs/decisions/README.md)
- [팀 기여·PR·squash 규칙](CONTRIBUTING.md)
- [API 수동 배포와 인프라 적용](docs/deployment.md)
- [Gmail 메일 기반과 수동 검증](docs/email.md)
- [Gemini 영상 요약과 공급자 검증](docs/gemini.md)
- [Android 연동 API 계약과 정책](docs/api-contract.md)
- [D1 제품 스키마와 마이그레이션](docs/database.md)
- [영속 분석·메일 실행 기반](docs/jobs.md)
- [공통 AI 작업 규칙](AGENTS.md)
