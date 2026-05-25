// Root project for the pg-policy-engine monorepo.
//
// This file holds settings shared across all subprojects. Subproject
// build logic lives in each subproject's own `build.gradle.kts`:
//   - engine/   the Kotlin engine library + CLI
//   - api/      (Phase 0.3) Ktor HTTP service wrapping engine primitives
//   - worker/   (Phase 0.3) background worker reading pgmq queues
//
// See spec/web-app-architecture-decision.md §D11 for repo layout.

allprojects {
    group = "com.pgpe"
    version = "0.1.0-SNAPSHOT"
}
