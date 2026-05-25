// Bootstrap a JDK 21 toolchain automatically via Foojay disco — so
// `gradle :engine:test` works without first installing a matching JDK
// or setting JAVA_HOME by hand. Required because the engine's Kotlin
// `jvmToolchain(21)` setting otherwise fails on systems where Gradle's
// default toolchain auto-detection can't find a Java 21 install.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "pg-policy-engine"

include(":engine")
include(":api")
include(":worker")
