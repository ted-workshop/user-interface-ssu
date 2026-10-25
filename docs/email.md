# Gmail 메일 발송 기반

관련 작업은 [#6](https://github.com/ted-workshop/user-interface-ssu/issues/6), 선택 근거와 한계는
[ADR-0012](decisions/0012-gmail-smtp-email-foundation.md)에 있어요.

## 현재 범위

`apps/api/src/email.ts`는 Gmail SMTP 접속 검사와 수신 주소 한 개의 발송을 제공해요.
기존 요약 서비스처럼 Nodemailer와 text·HTML 본문을 사용해요. 리포트 HTML을 만들 때는
기존 서비스의 Markdown 정제 방식을 참고하되, 이번 이슈에 리포트 렌더러를 복사하지 않아요.
인증 메일 정책·작업 DB·채널 발송과 재시도는 #7·#8·#9·#10·#15에서 연결해요.
공개 HTTP 발송 경로를 만들지 않으며 기본 API 검사와 health는 Gmail 키 없이 실행돼요.

## 계정 준비

Gmail 계정의 2단계 인증을 켜고 [앱 비밀번호](https://support.google.com/accounts/answer/185833)를 준비해요.
Google 계정 로그인 비밀번호를 SMTP 설정에 넣지 않아요. 도메인 구매·DNS 변경은 필요하지 않아요.
발신 주소와 SMTP envelope는 로그인 계정으로 고정하고 표시 이름은 Qletter예요.

로컬 수동 검증 자격증명은 Git에서 제외된 `apps/api/.artifacts/email/credentials.json`에 둬요.
다른 서비스의 자격증명 재사용 여부와 테스트 수신 주소는 계정 소유자와 먼저 맞춰요.

```sh
mkdir -p apps/api/.artifacts/email
cp apps/api/email.config.example.json apps/api/.artifacts/email/credentials.json
chmod 600 apps/api/.artifacts/email/credentials.json
```

복사한 파일의 `user`, `appPassword`, `testRecipient`를 개인 설정으로 채워요.
`user`는 발신 계정이고 `testRecipient`는 실제로 확인할 수신 주소예요. 두 주소가 같다고 가정하지 않아요.
검증 명령은 발신·수신 주소를 마스킹해 표시하므로, 보내기 전에 확인하는 계정이 맞는지 대조해요.
주소·비밀번호를 커밋하거나 PR·로그에 올리지 않아요. `.artifacts`의 JSON 파일은 Wrangler의
환경 타입 생성 입력이 아니므로 개인 계정에 따라 추적 중인 환경 타입이 바뀌지 않아요.
제품 Worker에 연결할 때는 `SMTP_USER`, `SMTP_APP_PASSWORD`를 Worker Secrets에 두고
`{ user: env.SMTP_USER, appPassword: env.SMTP_APP_PASSWORD }`를 공통 함수에 전달해요.
제품 연결 시 선언·환경 타입 생성과 배포 환경 Secret 준비를 함께 진행해요.

## 운영 자격증명 관리 제안

현재 `Deploy API` workflow에는 SMTP Secret 전달을 구현하지 않았어요. 아래는 제품 메일 연결 때 적용할 제안이에요.

GitHub 저장소의 `Settings → Environments → production → Environment secrets`에 운영 값을 보관해요.

| Secret | 값 |
| --- | --- |
| `SMTP_USER` | 발신 Gmail 계정 주소 |
| `SMTP_APP_PASSWORD` | 해당 계정의 Google 앱 비밀번호 |

수동 배포에서 이 두 값만 runner의 임시 파일로 전달하고, Wrangler의 `--secrets-file`로 코드와 함께
Cloudflare Worker Secrets에 등록하는 구성을 제안해요. Worker는 `env.SMTP_USER`와 `env.SMTP_APP_PASSWORD`를 사용해요.
GitHub Secret 변경만으로 실행 중인 Worker에 반영되지는 않으며 수동 배포가 필요해요.
PR·일반 Quality CI는 지금처럼 Gmail 키 없이 검사하고 실제 메일을 보내지 않아요.

로컬 수동 검증은 위의 Git 제외 파일을 계속 사용해요. 개인 `testRecipient`는 운영 Secret에 넣지 않아요.
앱 비밀번호는 Terraform 입력·state, Wrangler의 공개 `vars`, 로그·artifact에 넣지 않는 방향이에요.
근거·대안·미구현 범위는 [ADR-0012의 운영 관리 제안](decisions/0012-gmail-smtp-email-foundation.md#운영-자격증명-원본과-배포-전달-제안--2026-10-25)에 있어요.

## 단계별 검증

```sh
# 인증·발송 없이 TCP·TLS·SMTP greeting/EHLO까지만 확인해요.
mise exec -- bun run --cwd apps/api email handshake
# 인증까지 확인하며 메일은 보내지 않아요.
mise exec -- bun run --cwd apps/api email verify
# 테스트 메시지를 준비하고 deliveryId를 출력해요. 아직 보내지 않아요.
mise exec -- bun run --cwd apps/api email prepare
# 출력된 UUID를 직접 넣어요. 허가된 수신 주소에 한 번 시도해요.
mise exec -- bun run --cwd apps/api email send <deliveryId>
# 로컬 시도 결과와 Gmail 보낸편지함 검색식을 확인해요.
mise exec -- bun run --cwd apps/api email result <deliveryId>
```

`handshake`·`verify`·SMTP `250` 접수·실제 받은편지함 도착·사람의 열람은 각각 다른 증거예요.
받은편지함/스팸함에서 제목의 확인 번호와 Message-ID를 대조해야 실제 수신으로 기록해요.
`result`는 Gmail을 조회하는 명령이 아니라 로컬 시도 기록을 읽는 명령이에요.

수동 검증 도구는 보내기 전에 시도 파일을 독점 생성해요. 같은 ID의 동시 실행이나 프로세스
중단 후 재실행은 SMTP 호출 전에 차단해요. 접수 결과 기록이 유실돼도 자동으로 다시 보내지 않아요.
명시적인 거부 원인을 해결한 뒤에는 새 테스트 메시지를 준비할 수 있지만, 결과 불명 상태에서는
새 ID로 우회 재발송하지 않고 먼저 아래 절차로 확인해요.

## 실패와 결과 불명

| reason | 의미 | 다음 행동 |
| --- | --- | --- |
| `configuration` | 자격증명 누락·인증 실패 | 앱 비밀번호·계정 보안 상태를 확인해요. |
| `invalid_input` | 잘못된 주소·deliveryId·본문 | 입력을 고쳐요. SMTP 호출 전 거부해요. |
| `temporary` | Nodemailer가 일시적으로 분류한 SMTP 거부(4xx·503 등) 또는 SMTP 전 TLS 연결 실패 | 원인을 확인한 뒤 후속 작업 정책으로 재시도해요. |
| `permanent` | Nodemailer가 영구적으로 분류한 SMTP 거부(503을 제외한 5xx) | 주소·내용·정책을 수정하기 전 반복하지 않아요. |
| `quota` | Gmail의 `550 5.4.5` 한도 거부 | 발송을 중단하고 계정 사용량·제한 해제를 확인해요. |
| `ambiguous` | 접수 결과를 알 수 없는 연결 종료·시간 초과·알 수 없는 오류 | 자동 재발송을 멈추고 보낸편지함·수신함을 확인해요. |

Gmail은 멱등성 키를 제공하지 않아요. 같은 Message-ID로 다시 보내도 중복이 제거된다고 보장하지 않아요.
`deliveryId`는 수신 주소·용도별로 만들고 최초 발송 전에 저장해요. Message-ID는 그 ID에서 만들어
보낸편지함 검색에 사용해요. 검색식은 `in:sent rfc822msgid:<꺾쇠를 뺀 Message-ID>`예요.
검색 결과가 없다는 사실만으로 미발송을 확정하지 않아요.

SMTP 오류의 `command=CONN`도 미발송 증거가 아니에요. Nodemailer는 DATA 이후 소켓 오류에도
이 값을 붙이므로, 응답 코드가 없는 오류는 공통 함수에서 결과 불명으로 다뤄요.
제품의 영구 발송 기록·동시 실행 claim·계정/수신 설정 재확인은 후속 작업에서 구현해야 해요.
이번 공통 함수나 로컬 시도 파일만으로 제품 전체의 정확히 한 번 발송을 보장하지 않아요.

## 무료 조건과 운영 범위

2026-10-25 [Google 공식 안내](https://support.google.com/mail/answer/22839?hl=en)를 확인했어요.
개인 Gmail은 하루 500통 초과 등에 제한을 적용하고, 제한 시 보통 1~24시간 후 다시 보낼 수 있다고 안내해요.
실제 계정의 남은 할당량을 SMTP에서 조회할 수 있는 API로 확인한 결과는 아니에요.
기존 요약 서비스와 같은 계정을 쓰면 사용량도 공유하므로 500통을 Qletter의 가용량으로 계산하지 않아요.
[Nodemailer Gmail 안내](https://nodemailer.com/guides/using-gmail)는 서버 위치·의심스러운 IP에 따른 차단과
대규모 자동 발송의 한계를 설명해요. 실제 배포 위치에서 인증·발송을 별도로 확인해야 해요.

2026-10-25에 허가받은 기존 Gmail 계정으로 로컬 workerd 인증과 본인 주소로 1통 발송을 확인했어요.
읽기 전용 IMAP 조회에서 선택한 기존 발신 계정 자체의 받은편지함 도착·Message-ID·제목·text/HTML 본문 일치까지 확인했어요.
이 첫 테스트의 수신 주소는 발신 계정과 같았으며, 사용자가 평소 확인하는 다른 메일 주소에 보낸 결과는 아니에요.
이후 사용자가 지정한 외부 iCloud 주소로도 별도 테스트 1통을 접수하고 Gmail 보낸편지함의 To 헤더를 대조했어요.
이 외부 주소는 사용자가 받은편지함 도착을 확인했어요. iCloud 메일함을 직접 조회한 결과는 아니며,
앞선 Gmail 계정의 IMAP 본문 대조와 사용자 수신 확인을 구분해 기록해요.
배포된 Worker의 발송이나 제품 인증/리포트 메일 연동을 검증한 결과는 아니에요.
공급자 인증·발송·수신 검증의 상세 근거는 [ADR-0012](decisions/0012-gmail-smtp-email-foundation.md)에 있어요. 한도 소진·계정 차단·결과 불명이 생기면
자동 재시도나 유료 전환 대신 발송을 멈추고 원인을 확인해요.
