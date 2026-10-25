// 모든 하위 모듈에서 공통으로 쓰는 빌드 설정을 정의해요.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.spotless) apply false
}
