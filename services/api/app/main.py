from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.data_provider import list_relevant_records
from app.engine import build_final_plan, build_overview, build_profile_summary, recommend
from app.models import DataStatus, ExplainRequest, ExplainResponse, RecommendationRequest, RecommendationResponse
from app.settings import get_settings
from app.style_explainer import explain

settings = get_settings()

app = FastAPI(
    title="Gaokao Volunteer Assistant API",
    version="0.1.0",
    summary="MVP API for structured college recommendation and style explanation",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=settings.effective_cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def healthcheck() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "environment": settings.app_env,
        "public_api_ready": bool(settings.public_base_url),
    }


@app.post("/api/recommendations", response_model=RecommendationResponse)
def create_recommendations(request: RecommendationRequest) -> RecommendationResponse:
    catalog, records = list_relevant_records(request.profile)
    recommendations = recommend(request.profile, records)
    summary = build_profile_summary(request.profile)
    data_status = DataStatus(
        source_name=catalog.source_name,
        source_type=catalog.source_type,
        updated_at=catalog.updated_at,
        notes=catalog.notes,
        matched_record_count=len(records),
    )
    overview = build_overview(request.profile, recommendations)
    final_plan = build_final_plan(request.profile, recommendations)
    return RecommendationResponse(
        profile_summary=summary,
        recommendations=recommendations,
        data_status=data_status,
        overview=overview,
        final_plan=final_plan,
    )


@app.post("/api/explanations", response_model=ExplainResponse)
def create_explanation(request: ExplainRequest) -> ExplainResponse:
    answer, mode = explain(request)
    return ExplainResponse(answer=answer, mode=mode)
