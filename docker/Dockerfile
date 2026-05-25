# Single image, two processes (per Fly.io's `[processes]` config and
# ADR D14). ENTRYPOINT dispatches based on PROCESS_NAME:
#   PROCESS_NAME=http   -> runs the Ktor api service
#   PROCESS_NAME=worker -> runs the pgmq background worker

# ---------- Build stage ----------
FROM gradle:9-jdk21 AS build
WORKDIR /home/gradle/project
COPY --chown=gradle:gradle . .
RUN gradle :api:installDist :worker:installDist --no-daemon -x test

# ---------- Runtime stage ----------
# Use a glibc-based JRE (not Alpine/musl) so the engine's Z3 native
# libraries load cleanly. Z3 ships glibc binaries via z3-turnkey.
FROM eclipse-temurin:21-jre-noble AS runtime
WORKDIR /app

COPY --from=build /home/gradle/project/api/build/install/api ./api
COPY --from=build /home/gradle/project/worker/build/install/worker ./worker
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default to http; Fly.io overrides per-process via [processes].
ENV PROCESS_NAME=http
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
