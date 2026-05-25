plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    application
}

repositories {
    mavenCentral()
}

// Ktor pinned to the 3.1.x line for compatibility with Kotlin 2.1.20.
// Newer Ktor versions (3.3+) bundle kotlinx-serialization compiled
// against Kotlin 2.3 metadata, which our compiler can't read.
val ktorVersion = "3.1.3"

dependencies {
    implementation(project(":engine"))

    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    implementation("io.ktor:ktor-server-call-logging:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("io.ktor:ktor-server-cors:$ktorVersion")
    implementation("io.ktor:ktor-server-auth:$ktorVersion")
    implementation("io.ktor:ktor-server-auth-jwt:$ktorVersion")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    implementation("io.github.oshai:kotlin-logging-jvm:7.0.7")
    runtimeOnly("ch.qos.logback:logback-classic:1.5.12")
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("com.pgpe.api.MainKt")
}
