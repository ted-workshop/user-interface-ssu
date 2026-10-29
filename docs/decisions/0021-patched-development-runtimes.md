# ADR-0021: 개발 런타임의 보안 패치 버전을 고정해요

- 상태: 확정
- 작성일: 2026-10-27
- 확정일과 근거: 2026-10-27 사용자가 프로젝트 고정 버전 갱신과 구버전 삭제를 승인했어요.
- 관련 기록: [ADR-0009](0009-manual-deployment-ownership.md), [ADR-0011](0011-scoped-quality-checks.md)
- 구현·검증 상태: 2026-10-27에 mise·packageManager·개발 문서를 갱신했어요. macOS arm64에서 `mise run check`와 새 JDK로 재시작한 뒤의 `mise run android:check`를 통과했어요. 배포·기기 UI·외부 공급자 검증은 실행하지 않았어요.

## 문제와 현재 상태

이전 mise 설정은 Bun 1.4.2, Node.js 24.15.0, OpenJDK 25.0.2를 다시 설치해요.
개발 PC에서 구버전을 제거해도 프로젝트 설정이 원인을 되살리므로 함께 갱신해요.

## 결정

Bun 1.4.4, Node.js 24.22.1, Eclipse Temurin 25.0.5+8 LTS를 정확한 버전으로 고정해요.
JDK major 25와 Java 컴파일 대상 11은 유지해요. 의존성 버전과 lockfile은 바꾸지 않아요.

## 근거와 대안

2026-10-27 mise의 OpenJDK 목록은 25.0.2에서 멈추고 Temurin은 25.0.5+8을 제공했어요.
[Adoptium 공식 릴리스](https://github.com/adoptium/temurin25-binaries/releases/tag/jdk-25.0.5%2B8)는 같은 Java major의 패치 업데이트를 제공해요.
OpenJDK 25.0.2 유지는 보안 업데이트 목적을 충족하지 못하고, major 변경은 호환성 범위를 넓히므로 선택하지 않아요.

## 가정·한계와 영향

Temurin의 Gradle·Android 호환성은 이 환경의 전체 검사로 확인해요.
빌드 성공이 Android Studio sync·기기 동작·배포 완료를 뜻하지 않아요.

## 검증과 재검토 조건

새 고정 버전으로 `mise run check`를 실행해 API의 workerd 테스트·Android 빌드·Terraform 로컬 검사를 확인해요.
버전 출력과 전체 검사 결과를 확인한 뒤 구버전을 삭제해요. 새 패치 공개나 실제 호환성 오류가 있으면 재검토해요.

2026-10-30에 main `a528b9a`에 이 변경을 적용하고 macOS arm64에서 전체 검사를 다시 통과했어요.
Bun 1.4.4·Node.js 24.22.1·Temurin 25.0.5+8 실행 버전을 확인했고, frozen lockfile 설치,
workerd 120개·API 도구 16개·공통 도구 49개 테스트, Android 포맷·Lint·단위 테스트·debug 빌드,
Terraform의 원격 backend를 사용하지 않는 초기화·검증이 성공했어요. 문서의 상대 링크와 공식 JDK 릴리스도 확인했어요.

## 변경 이력

- 2026-10-27: 승인 범위 안에서 같은 JDK major의 보안 패치 제공 배포판을 선택했어요.
- 2026-10-30: 사용자가 이슈 없이 보안 업데이트를 main에 반영하도록 승인했어요. 최신 main의 기존 기록과 번호가 겹쳐 ADR-0021로 옮겼어요.
