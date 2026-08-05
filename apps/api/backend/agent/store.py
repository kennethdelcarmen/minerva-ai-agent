"""Filesystem-backed run artifact store."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

from backend.contracts.models import ArtifactDescriptor, RunEvent, RunStatusResponse, classify_artifact


class RunStore:
    """Persist events and artifacts for a run."""

    def __init__(self, artifact_root: Path):
        self.artifact_root = artifact_root
        self.artifact_root.mkdir(parents=True, exist_ok=True)

    def create_run_dir(self, run_id: str) -> Path:
        run_dir = self.artifact_root / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "downloads").mkdir(exist_ok=True)
        (run_dir / "screenshots").mkdir(exist_ok=True)
        (run_dir / "traces").mkdir(exist_ok=True)
        (run_dir / "videos").mkdir(exist_ok=True)
        return run_dir

    def append_event(self, run_dir: Path, event: RunEvent) -> None:
        event_file = run_dir / "events.jsonl"
        with event_file.open("a", encoding="utf-8") as handle:
            handle.write(event.model_dump_json())
            handle.write("\n")

    def iter_events(self, run_dir: Path, *, up_to_sequence: int | None = None) -> Iterator[RunEvent]:
        event_file = run_dir / "events.jsonl"
        if not event_file.exists():
            return iter(())

        def _iter() -> Iterator[RunEvent]:
            with event_file.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    event = RunEvent.model_validate_json(line)
                    if up_to_sequence is not None and event.sequence > up_to_sequence:
                        break
                    yield event

        return _iter()

    def write_result(self, run_dir: Path, status: RunStatusResponse, final_output: dict) -> None:
        result_path = run_dir / "result.json"
        payload = {
            "status": status.model_dump(mode="json"),
            "result": final_output,
        }
        result_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def read_status(self, run_dir: Path) -> RunStatusResponse:
        result_path = run_dir / "result.json"
        if not result_path.exists():
            raise FileNotFoundError(f"Run result not found for {run_dir.name}")

        payload = json.loads(result_path.read_text(encoding="utf-8"))
        status = payload.get("status")
        if not isinstance(status, dict):
            raise ValueError(f"Run result for {run_dir.name} is missing a valid status payload")
        return RunStatusResponse.model_validate(status)

    def list_artifacts(self, run_dir: Path) -> list[ArtifactDescriptor]:
        artifacts: list[ArtifactDescriptor] = []
        if not run_dir.exists():
            return artifacts

        for path in sorted(p for p in run_dir.rglob("*") if p.is_file()):
            rel_path = path.relative_to(run_dir)
            artifacts.append(
                ArtifactDescriptor(
                    kind=classify_artifact(rel_path),
                    path=rel_path.as_posix(),
                    size_bytes=path.stat().st_size,
                )
            )
        return artifacts

    def resolve_artifact_path(self, run_dir: Path, artifact_path: str) -> Path:
        root = run_dir.resolve()
        candidate = (run_dir / artifact_path).resolve()

        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"Artifact path {artifact_path!r} is outside the run directory") from exc

        if not candidate.exists() or not candidate.is_file():
            raise FileNotFoundError(f"Artifact {artifact_path!r} not found")

        return candidate

    def resolve_run_dir(self, run_id: str) -> Path:
        run_dir = self.artifact_root / run_id
        if not run_dir.exists() or not run_dir.is_dir():
            raise KeyError(f"Run {run_id} not found")
        return run_dir
