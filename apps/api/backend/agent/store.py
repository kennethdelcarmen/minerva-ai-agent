"""Filesystem-backed run artifact store."""

from __future__ import annotations

import json
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

    def write_result(self, run_dir: Path, status: RunStatusResponse, final_output: dict) -> None:
        result_path = run_dir / "result.json"
        payload = {
            "status": status.model_dump(mode="json"),
            "result": final_output,
        }
        result_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

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
