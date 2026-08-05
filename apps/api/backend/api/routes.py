"""HTTP routes for run management."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from backend.agent.service import RunService
from backend.api.dependencies import get_run_service
from backend.contracts.models import ApprovalDecisionRequest, CreateRunRequest, RunArtifactsResponse, RunStatusResponse

router = APIRouter()


@router.get("/healthz")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/runs", response_model=RunStatusResponse, status_code=201)
async def create_run(request: CreateRunRequest, service: RunService = Depends(get_run_service)) -> RunStatusResponse:
    return await service.create_run(request)


@router.get("/runs/{run_id}", response_model=RunStatusResponse)
async def get_run(run_id: str, service: RunService = Depends(get_run_service)) -> RunStatusResponse:
    try:
        return await service.get_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/approvals/{approval_id}", response_model=RunStatusResponse)
async def decide_approval(
    run_id: str,
    approval_id: str,
    request: ApprovalDecisionRequest,
    service: RunService = Depends(get_run_service),
) -> RunStatusResponse:
    try:
        return await service.decide_approval(run_id, approval_id, request.decision, request.note)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/stop", response_model=RunStatusResponse)
async def stop_run(run_id: str, service: RunService = Depends(get_run_service)) -> RunStatusResponse:
    try:
        return await service.stop_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs/{run_id}/artifacts", response_model=RunArtifactsResponse)
async def list_artifacts(run_id: str, service: RunService = Depends(get_run_service)) -> RunArtifactsResponse:
    try:
        return await service.list_artifacts(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs/{run_id}/artifacts/{artifact_path:path}")
async def get_artifact(run_id: str, artifact_path: str, service: RunService = Depends(get_run_service)) -> FileResponse:
    try:
        file_path = await service.get_artifact_path(run_id, artifact_path)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return FileResponse(file_path)


@router.get("/runs/{run_id}/events")
async def stream_run_events(run_id: str, service: RunService = Depends(get_run_service)) -> StreamingResponse:
    try:
        queue = await service.subscribe(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    async def event_stream():
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                payload = event.model_dump(mode="json")
                yield f"event: {event.type.value}\n"
                yield f"data: {json.dumps(payload)}\n\n"
        finally:
            try:
                await service.unsubscribe(run_id, queue)
            except KeyError:
                pass

    return StreamingResponse(event_stream(), media_type="text/event-stream")
