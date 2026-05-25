// Root project for the pg-policy-engine monorepo.
//
// This file holds settings shared across all subprojects. Subproject
// build logic lives in each subproject's own `build.gradle.kts`:
//   - engine/   the Kotlin engine library + CLI
//   - api/      (Phase 0.3) Ktor HTTP service wrapping engine primitives
//   - worker/   (Phase 0.3) background worker reading pgmq queues
//
// See spec/web-app-architecture-decision.md §D11 for repo layout.

// Centralize plugin versions here so each subproject declares the plugin
// without a version (Gradle warns when the same plugin version is loaded
// in multiple subprojects). Subprojects apply via `kotlin("jvm")` etc.
// without their own version string.
plugins {
    kotlin("jvm") version "2.1.20" apply false
    kotlin("plugin.serialization") version "2.1.20" apply false
}

allprojects {
    group = "com.pgpe"
    version = "0.1.0-SNAPSHOT"
}
