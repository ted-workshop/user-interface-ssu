import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.spotless)
}

val apiBaseUrl =
    providers.gradleProperty("qletter.apiBaseUrl").orElse("http://10.0.2.2:3000/").get()
val apiUri = URI(apiBaseUrl)

require(
    apiUri.scheme in listOf("http", "https") &&
        apiUri.host != null &&
        apiUri.rawUserInfo == null &&
        apiUri.rawQuery == null &&
        apiUri.rawFragment == null
) {
    "qletter.apiBaseUrl must be an HTTP(S) base URL without credentials, query, or fragment."
}

android {
    namespace = "kr.ac.ssu.qletter"
    compileSdk { version = release(37) }

    defaultConfig {
        applicationId = "kr.ac.ssu.qletter"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        }
        release { optimization { enable = false } }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures { buildConfig = true }
}

java { toolchain { languageVersion.set(JavaLanguageVersion.of(25)) } }

spotless {
    java {
        target("src/**/*.java")
        googleJavaFormat("1.28.0")
    }
    kotlinGradle {
        target("*.gradle.kts")
        ktfmt("0.59").kotlinlangStyle()
    }
}

dependencies {
    implementation(libs.activity)
    implementation(libs.appcompat)
    implementation(libs.constraintlayout)
    implementation(libs.material)
    testImplementation(libs.junit)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(libs.ext.junit)
    debugImplementation(libs.lifecycle.viewmodel)
    debugImplementation(libs.lifecycle.livedata)
    debugImplementation(libs.okhttp)
    debugImplementation(libs.moshi)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.arch.core.testing)
}
