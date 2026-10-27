pluginManagement {
    repositories {
        google {
            content {
                // Google 저장소에서 com.android로 시작하는 플러그인 그룹을 조회해요.
                includeGroupByRegex("com\\.android.*")
                // Google 저장소에서 com.google로 시작하는 플러그인 그룹을 조회해요.
                includeGroupByRegex("com\\.google.*")
                // Google 저장소에서 androidx로 시작하는 플러그인 그룹을 조회해요.
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "qletter"
include(":app")
