from typing import Literal

from pydantic import BaseModel, Field


Tier = Literal["冲", "稳", "保"]


class UserProfile(BaseModel):
    province: str = Field(..., description="Gaokao province")
    score: int = Field(..., ge=0)
    rank: int = Field(..., ge=1, description="Lower rank means better performance")
    subject_track: str = Field(..., description="Physics, history, arts, science, or custom track")
    preferred_cities: list[str] = Field(default_factory=list)
    preferred_majors: list[str] = Field(default_factory=list)
    school_focus: Literal["名校导向", "行业强校", "区域重点", "应用导向"] | None = None
    city_focus: Literal["一线/新一线", "省会优先", "城市不是第一位"] | None = None
    career_goal: str = Field(default="就业优先")
    strategy_mode: Literal["均衡", "学校优先", "专业优先"] = Field(default="均衡")
    risk_preference: Literal["保守", "均衡", "冲刺"] = Field(default="均衡")
    accepts_adjustment: bool = Field(default=False)


class AdmissionRecord(BaseModel):
    school_name: str
    city: str
    major_name: str
    tags: list[str]
    career_paths: list[str]
    school_tier: Literal["名校导向", "行业强校", "区域重点", "应用导向"] = "区域重点"
    employment_strength: Literal["一般", "较强", "强"] = "较强"
    min_rank: int = Field(..., description="Most competitive historical rank")
    max_rank: int = Field(..., description="Least competitive historical rank")
    adjustment_risk: Literal["低", "中", "高"]
    postgrad_strength: Literal["一般", "较强", "强"]
    provinces: list[str] = Field(default_factory=list)
    subject_tracks: list[str] = Field(default_factory=list)
    batch: str = "本科批"
    year: int = 2025


class RecommendationItem(BaseModel):
    tier: Tier
    school_name: str
    city: str
    major_name: str
    match_score: float
    rank_window: str
    reasoning: list[str]
    risk_hint: str
    batch: str
    reference_year: int
    school_tier: str


class RecommendationOverview(BaseModel):
    strategy_summary: str
    next_action: str
    tier_counts: dict[Tier, int]


class FinalPlanItem(BaseModel):
    order: int
    tier: Tier
    school_name: str
    major_name: str
    city: str
    match_score: float
    fill_reason: str


class FinalPlan(BaseModel):
    summary: str
    fill_strategy: str
    items: list[FinalPlanItem]
    reminder: str


class DataStatus(BaseModel):
    source_name: str
    source_type: Literal["demo", "real"]
    updated_at: str | None = None
    notes: str | None = None
    matched_record_count: int = 0


class RecommendationRequest(BaseModel):
    profile: UserProfile


class RecommendationResponse(BaseModel):
    profile_summary: str
    recommendations: list[RecommendationItem]
    data_status: DataStatus
    overview: RecommendationOverview
    final_plan: FinalPlan


class ExplainRequest(BaseModel):
    profile: UserProfile
    recommendations: list[RecommendationItem]
    focus_question: str | None = None
    analysis_mode: Literal["general", "compare"] = "general"


class ExplainResponse(BaseModel):
    answer: str
    mode: Literal["mock", "openclaw"]
