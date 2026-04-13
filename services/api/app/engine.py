from app.models import (
    AdmissionRecord,
    FinalPlan,
    FinalPlanItem,
    RecommendationItem,
    RecommendationOverview,
    UserProfile,
)


def build_profile_summary(profile: UserProfile) -> str:
    cities = "、".join(profile.preferred_cities) if profile.preferred_cities else "城市不限"
    majors = "、".join(profile.preferred_majors) if profile.preferred_majors else "专业方向待探索"
    adjustment = "接受调剂" if profile.accepts_adjustment else "不接受调剂"
    school_focus = f"，学校偏好 {profile.school_focus}" if profile.school_focus else ""
    city_focus = f"，城市取向 {profile.city_focus}" if profile.city_focus else ""
    return (
        f"{profile.province}考生，分数 {profile.score}，位次 {profile.rank}，"
        f"{profile.subject_track}，偏好城市 {cities}，偏好专业 {majors}，"
        f"目标 {profile.career_goal}{city_focus}{school_focus}，策略 {profile.strategy_mode}，"
        f"风险偏好 {profile.risk_preference}，{adjustment}。"
    )


def recommend(profile: UserProfile, records: list[AdmissionRecord]) -> list[RecommendationItem]:
    scored: list[tuple[float, RecommendationItem]] = []

    for record in records:
        city_bonus = _city_bonus(profile, record)
        major_bonus = _match_major_bonus(profile.preferred_majors, record, profile.strategy_mode)
        goal_bonus = _goal_bonus(profile.career_goal, record)
        school_bonus = _school_bonus(profile, record)
        rank_score, tier = _rank_score(profile.rank, record, profile.risk_preference)

        if tier is None:
            continue

        adjustment_penalty = 0.0
        if not profile.accepts_adjustment and record.adjustment_risk == "高":
            adjustment_penalty = 10.0
        elif not profile.accepts_adjustment and record.adjustment_risk == "中":
            adjustment_penalty = 4.0

        match_score = max(
            1.0,
            rank_score + city_bonus + major_bonus + goal_bonus + school_bonus - adjustment_penalty,
        )
        reason = _build_reasoning(profile, record, tier)

        item = RecommendationItem(
            tier=tier,
            school_name=record.school_name,
            city=record.city,
            major_name=record.major_name,
            match_score=round(match_score, 1),
            rank_window=f"{record.min_rank} - {record.max_rank}",
            reasoning=reason,
            risk_hint=(
                f"调剂风险 {record.adjustment_risk}，升学实力 {record.postgrad_strength}，"
                f"就业强度 {record.employment_strength}"
            ),
            batch=record.batch,
            reference_year=record.year,
            school_tier=record.school_tier,
        )
        scored.append((match_score, item))

    scored.sort(key=lambda pair: (-pair[0], pair[1].school_name))

    grouped: dict[str, list[RecommendationItem]] = {"冲": [], "稳": [], "保": []}
    for _, item in scored:
        bucket = grouped[item.tier]
        if len(bucket) < 3:
            bucket.append(item)

    return grouped["冲"] + grouped["稳"] + grouped["保"]

def _rank_score(user_rank: int, record: AdmissionRecord, risk_preference: str) -> tuple[float, str | None]:
    if risk_preference == "保守":
        max_multiplier = 1.10
        aggressive_multiplier = 1.02
    elif risk_preference == "冲刺":
        max_multiplier = 1.25
        aggressive_multiplier = 1.08
    else:
        max_multiplier = 1.18
        aggressive_multiplier = 1.05

    if user_rank > int(record.max_rank * max_multiplier):
        return 0.0, None

    if user_rank > int(record.max_rank * aggressive_multiplier):
        return 74.0, "冲"

    if user_rank >= int(record.min_rank * 0.95):
        return 82.0, "稳"

    return 88.0, "保"


def _city_bonus(profile: UserProfile, record: AdmissionRecord) -> float:
    base = 8.0 if record.city in profile.preferred_cities else 0.0
    focus_bonus = 0.0
    if profile.city_focus == "一线/新一线" and record.city in {"上海", "深圳", "杭州", "南京", "苏州"}:
        focus_bonus = 4.0
    elif profile.city_focus == "省会优先" and record.city in {"南京", "杭州", "武汉", "成都", "广州", "济南", "石家庄"}:
        focus_bonus = 3.0
    if profile.career_goal == "城市优先" and record.city in {"上海", "深圳", "杭州", "南京", "苏州"}:
        focus_bonus += 4.0
    return base + focus_bonus


def _match_major_bonus(preferred_majors: list[str], record: AdmissionRecord, strategy_mode: str) -> float:
    if not preferred_majors:
        return 4.0

    bonus = 12.0 if strategy_mode == "专业优先" else 9.0
    lowered = " ".join([record.major_name, *record.tags]).lower()
    for major in preferred_majors:
        if major.lower() in lowered:
            return bonus
    return 0.0


def _school_bonus(profile: UserProfile, record: AdmissionRecord) -> float:
    tier_score = {
        "名校导向": 10.0,
        "行业强校": 8.0,
        "区域重点": 5.0,
        "应用导向": 4.0,
    }
    base_bonus = 0.0
    if profile.strategy_mode == "学校优先":
        base_bonus = tier_score.get(record.school_tier, 0.0)
    elif profile.strategy_mode == "均衡":
        base_bonus = tier_score.get(record.school_tier, 0.0) * 0.5

    if profile.school_focus and profile.school_focus == record.school_tier:
        if profile.strategy_mode == "学校优先":
            return base_bonus + 4.0
        return base_bonus + 2.0

    return base_bonus


def _goal_bonus(career_goal: str, record: AdmissionRecord) -> float:
    if "考研" in career_goal and record.postgrad_strength in {"较强", "强"}:
        return 8.0
    if "就业" in career_goal and any("就业" in tag or "稳定" in tag for tag in record.tags):
        employment_bonus = {"一般": 2.0, "较强": 6.0, "强": 8.0}
        return employment_bonus.get(record.employment_strength, 2.0)
    if "城市" in career_goal and record.city in {"上海", "深圳", "杭州", "南京", "苏州"}:
        return 6.0
    return 2.0


def _build_reasoning(profile: UserProfile, record: AdmissionRecord, tier: str) -> list[str]:
    reasons = [
        f"{tier}档：你的位次和该专业近年区间 {record.min_rank}-{record.max_rank} 有匹配空间。",
        (
            f"{record.school_name} 位于 {record.city}，专业方向是 {record.major_name}，"
            f"学校定位偏 {record.school_tier}，参考批次为 {record.batch}。"
        ),
        f"就业方向主要覆盖：{'、'.join(record.career_paths)}。",
    ]

    if record.city in profile.preferred_cities:
        reasons.append("城市偏好命中，可以优先考虑实际生活与实习资源。")

    if profile.city_focus and _matches_city_focus(profile.city_focus, record.city):
        reasons.append(f"城市取向命中，你当前更想优先靠近“{profile.city_focus}”这一类城市。")

    if profile.preferred_majors and _match_major_bonus(profile.preferred_majors, record, profile.strategy_mode) > 0:
        reasons.append("专业偏好命中，后续可围绕这个方向继续缩窄学校名单。")

    if profile.school_focus and record.school_tier == profile.school_focus:
        reasons.append(f"学校偏好命中，这个结果刚好贴近你想要的“{profile.school_focus}”路线。")

    if not profile.accepts_adjustment and record.adjustment_risk != "低":
        reasons.append("你不接受调剂，这个专业组要特别留意专业录取顺序和调剂规则。")

    if profile.strategy_mode == "学校优先":
        reasons.append("你当前更看重学校平台，系统会适当提高名校和行业强校的权重。")
    elif profile.strategy_mode == "专业优先":
        reasons.append("你当前更看重专业匹配，系统会优先照顾专业方向契合度。")

    if profile.risk_preference == "保守":
        reasons.append("你的风险偏好偏保守，系统会更严格过滤过于激进的候选项。")
    elif profile.risk_preference == "冲刺":
        reasons.append("你的风险偏好偏冲刺，系统会保留更多冲高机会。")

    return reasons


def _matches_city_focus(city_focus: str, city: str) -> bool:
    if city_focus == "一线/新一线":
        return city in {"上海", "深圳", "杭州", "南京", "苏州"}
    if city_focus == "省会优先":
        return city in {"南京", "杭州", "武汉", "成都", "广州", "济南", "石家庄"}
    return False


def build_overview(profile: UserProfile, recommendations: list[RecommendationItem]) -> RecommendationOverview:
    counts = {"冲": 0, "稳": 0, "保": 0}
    for item in recommendations:
        counts[item.tier] += 1

    primary_focus = "学校平台" if profile.strategy_mode == "学校优先" else "专业匹配" if profile.strategy_mode == "专业优先" else "学校与专业均衡"
    risk_focus = {
        "保守": "方案会更偏向确定性",
        "均衡": "方案会同时保留冲高和兜底",
        "冲刺": "方案会保留更多上限空间",
    }[profile.risk_preference]

    next_action = "下一步建议：先从稳档里挑 2-3 个最喜欢的方向，再决定是否增加冲刺院校。"
    if profile.strategy_mode == "专业优先":
        next_action = "下一步建议：先从专业契合度最高的 2 个方向继续细看课程、就业和调剂规则。"
    elif profile.strategy_mode == "学校优先":
        next_action = "下一步建议：先从学校平台最强的结果里筛出你愿意接受的专业，再看是否需要服从调剂。"

    return RecommendationOverview(
        strategy_summary=f"当前按“{profile.strategy_mode} + {profile.risk_preference}”策略生成，重点偏向 {primary_focus}，{risk_focus}。",
        next_action=next_action,
        tier_counts=counts,
    )


def build_final_plan(profile: UserProfile, recommendations: list[RecommendationItem]) -> FinalPlan:
    ordered_items: list[FinalPlanItem] = []
    for index, item in enumerate(recommendations, start=1):
        ordered_items.append(
            FinalPlanItem(
                order=index,
                tier=item.tier,
                school_name=item.school_name,
                major_name=item.major_name,
                city=item.city,
                match_score=item.match_score,
                fill_reason=_build_fill_reason(profile, item),
            )
        )

    tier_plan = {
        "保守": "建议按“冲 1-2 个 + 稳 3 个左右 + 保 2 个左右”去排，先守住确定性，再少量冲高。",
        "均衡": "建议按“冲 2 个 + 稳 3 个 + 保 2 个”去排，让上限和落地都留住。",
        "冲刺": "建议按“冲 2-3 个 + 稳 2-3 个 + 保 1-2 个”去排，给上限多留一点空间。",
    }[profile.risk_preference]

    if profile.strategy_mode == "学校优先":
        fill_strategy = "同一档内优先把学校平台更强、城市资源更好的候选项放前面。"
    elif profile.strategy_mode == "专业优先":
        fill_strategy = "同一档内优先把专业匹配更高、后续方向更清晰的候选项放前面。"
    else:
        fill_strategy = "同一档内兼顾学校平台、城市资源和专业匹配，不建议只盯一个维度。"

    reminder = "真正提交前，还要再核对招生章程、专业组限制、选科要求和调剂规则；保底志愿一定要放够。"
    if not profile.accepts_adjustment:
        reminder = "你当前不接受调剂，正式填报前一定要再核对专业录取顺序，保底志愿要放得更扎实。"

    return FinalPlan(
        summary="这是一版可直接落到志愿表里的顺序建议，越靠前代表越值得优先放位次更高的位置。",
        fill_strategy=f"{tier_plan}{fill_strategy}",
        items=ordered_items,
        reminder=reminder,
    )


def _build_fill_reason(profile: UserProfile, item: RecommendationItem) -> str:
    if item.tier == "冲":
        base = "适合放在前面做上限尝试，但不要全放冲档。"
    elif item.tier == "稳":
        base = "这是最适合承接主力志愿的位置，既要稳，也要尽量选你真想去的。"
    else:
        base = "这是兜底位，重点不是惊喜，而是确保最后有学上、专业能接受。"

    if profile.strategy_mode == "学校优先":
        strategy = "你当前更看重学校平台，所以同档里平台更强的可以略往前。"
    elif profile.strategy_mode == "专业优先":
        strategy = "你当前更看重专业方向，所以同档里专业更对口的可以略往前。"
    else:
        strategy = "你当前走均衡策略，所以排序时要一起看城市、学校和专业。"

    return f"{base}{strategy} 当前匹配分 {item.match_score}。"
