import json
import os
import re
import shlex
import shutil
import subprocess

from app.models import ExplainRequest


def explain(request: ExplainRequest) -> tuple[str, str]:
    style_mode = os.getenv("STYLE_MODE", "mock").strip().lower()

    if style_mode == "openclaw":
        try:
            prompt = _build_prompt(request)
            output = _call_openclaw(prompt)
            if output:
                return _normalize_answer_text(output), "openclaw"
        except Exception:
            pass

    return _normalize_answer_text(_mock_response(request)), "mock"


def _call_openclaw(prompt: str) -> str:
    configured_command = os.getenv("OPENCLAW_COMMAND", "").strip()
    if configured_command:
        args = shlex.split(configured_command, posix=os.name != "nt")
        completed = subprocess.run(
            args,
            input=prompt,
            text=True,
            capture_output=True,
            encoding="utf-8",
            errors="ignore",
            check=True,
        )
        return _extract_openclaw_output(completed.stdout)

    agent_name = os.getenv("OPENCLAW_AGENT", "main").strip() or "main"
    timeout_seconds = os.getenv("OPENCLAW_TIMEOUT", "90").strip() or "90"
    openclaw_bin = _resolve_openclaw_binary()
    args = [
        openclaw_bin,
        "agent",
        "--agent",
        agent_name,
        "--message",
        prompt,
        "--json",
        "--timeout",
        timeout_seconds,
    ]
    completed = subprocess.run(
        args,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="ignore",
        check=True,
    )
    return _extract_openclaw_output(completed.stdout)


def _resolve_openclaw_binary() -> str:
    configured = os.getenv("OPENCLAW_BIN", "").strip()
    if configured:
        return configured

    for candidate in ("openclaw.cmd", "openclaw.exe", "openclaw"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved

    return "openclaw"


def _extract_openclaw_output(raw_output: str) -> str:
    text = raw_output.strip()
    if not text:
        return ""

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text

    payloads = payload.get("payloads") or []
    chunks: list[str] = []
    for item in payloads:
        value = (item or {}).get("text")
        if value:
            chunks.append(value.strip())

    return "\n\n".join(chunk for chunk in chunks if chunk)


def _normalize_answer_text(text: str) -> str:
    cleaned = text.replace("**", "").replace("__", "")
    cleaned = re.sub(r"(?m)^\s*\*\s+", "- ", cleaned)
    cleaned = re.sub(r"(?m)^\s*-\s+\*\s+", "- ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _build_prompt(request: ExplainRequest) -> str:
    profile = request.profile
    picks = []
    for item in request.recommendations[:6]:
        picks.append(
            f"{item.tier}档 | {item.school_name} | {item.major_name} | {item.city} | "
            f"学校定位 {item.school_tier} | 参考年份 {item.reference_year} | "
            f"位次区间 {item.rank_window} | 风险提示 {item.risk_hint} | "
            f"理由：{'；'.join(item.reasoning)}"
        )

    follow_up = request.focus_question or "请结合这批推荐，给出清晰、接地气、带判断的分析。"
    tier_summary = _build_tier_summary(request)
    focus_mode = _infer_focus_mode(follow_up)
    focus_rules = _build_focus_rules(focus_mode)
    compare_rules = _build_compare_rules(request)

    return (
        "请切换到“张雪峰式分析风格”的升学顾问视角回答，但不要冒充真实人物本人。\n"
        "你说话要像一个见过大量真实案例、敢下判断、重就业结果的志愿顾问。\n"
        "要求：\n"
        "1. 先说结论，再说理由，不要铺垫半天。\n"
        "2. 必须说明为什么适合或不适合，不能只给空话。\n"
        "3. 必须体现冲稳保逻辑，而且要指出最值得先看的 1-2 个结果。\n"
        "4. 语言可以直接、有判断，但不能攻击用户，也不能制造绝对保证。\n"
        "5. 如果当前数据是演示数据，不要说成真实报考结论。\n"
        "6. 回答适合手机阅读，控制在大约 450 到 800 字之间，段落短，不要长篇大论。\n"
        "7. 少讲官话套话，尽量用“这值不值、稳不稳、有没有用、别赌什么”这种判断性表达。\n"
        "8. 如果是比较决策，必须直接说更推荐谁，理由是什么，谁排第二，谁更适合保底。\n"
        "输出结构必须固定为：\n"
        "【一句话结论】\n【重点判断】\n【怎么填更稳】\n【风险提醒】\n【下一步】\n"
        f"考生信息：省份={profile.province}，分数={profile.score}，位次={profile.rank}，"
        f"科类/选科={profile.subject_track}，城市偏好={','.join(profile.preferred_cities) or '无'}，"
        f"专业偏好={','.join(profile.preferred_majors) or '无'}，目标={profile.career_goal}，"
        f"策略={profile.strategy_mode}，风险偏好={profile.risk_preference}，"
        f"接受调剂={'是' if profile.accepts_adjustment else '否'}。\n"
        f"候选分布：{tier_summary}\n"
        f"当前追问类型：{focus_mode}\n"
        f"本轮回答加重规则：{focus_rules}\n"
        f"比较模式规则：{compare_rules}\n"
        f"候选结果：\n- " + "\n- ".join(picks) + "\n"
        f"用户追问：{follow_up}\n"
        "请给出明确判断，不要写成泛泛鸡汤。最后一定给一个能马上执行的下一步。"
    )


def _mock_response(request: ExplainRequest) -> str:
    if not request.recommendations:
        return "这份数据现在还不够，我没法负责任地给你建议，先把位次和专业偏好补完整。"

    top = request.recommendations[0]
    second = request.recommendations[1] if len(request.recommendations) > 1 else None
    follow_up = request.focus_question or "请做整体分析"
    focus_mode = _infer_focus_mode(follow_up)
    conservative_line = "你现在别先想着一步到位，先把稳档站住。" if request.profile.risk_preference == "保守" else "你现在可以保留一点冲高空间，但别全拿去赌。"
    strategy_line = _mock_strategy_line(request)
    next_pick_line = f"如果你要我只先盯一个结果，我会先看 {top.school_name} 的 {top.major_name}。"
    if second:
        next_pick_line += f" 第二个可以对比 {second.school_name} 的 {second.major_name}，这两个放一起看最容易做决策。"

    focus_line = _mock_focus_line(focus_mode, request, top, second)
    compare_line = _mock_compare_line(request, top, second)

    return (
        "【一句话结论】\n"
        f"这版结果能看，但现在最重要的不是贪多，而是先把主线选出来。{next_pick_line}\n\n"
        "【重点判断】\n"
        f"{top.school_name} 放在前面，不是因为名字最大，而是因为它的位次区间 {top.rank_window} 跟你当前位置有衔接空间，"
        f"而且专业是 {top.major_name}，城市在 {top.city}，方向比较实。{strategy_line}{focus_line}{compare_line}\n\n"
        "【怎么填更稳】\n"
        f"你现在要把冲、稳、保分开看。冲的是给上限，稳的是保主线，保的是兜底。{conservative_line}"
        " 真填的时候，先从稳档里挑你真正愿意去的，再决定冲档要不要往上抬。\n\n"
        "【风险提醒】\n"
        f"{top.risk_hint}。如果你继续追问“{follow_up}”，别泛泛聊，重点盯城市、专业和调剂规则，不然很容易看着热闹，填的时候手乱。\n\n"
        "【下一步】\n"
        "下一步建议：把你最想去的 2 个城市、最不能接受的 2 个专业先定死，然后我们再把结果继续往下收。"
    )


def _build_tier_summary(request: ExplainRequest) -> str:
    counts = {"冲": 0, "稳": 0, "保": 0}
    for item in request.recommendations:
        counts[item.tier] += 1
    return f"冲 {counts['冲']} 个，稳 {counts['稳']} 个，保 {counts['保']} 个"


def _mock_strategy_line(request: ExplainRequest) -> str:
    if request.profile.strategy_mode == "学校优先":
        return "你现在更看重学校平台，所以系统会把学校名气和平台资源的权重拉高。"
    if request.profile.strategy_mode == "专业优先":
        return "你现在更看重专业方向，所以系统会优先保住专业匹配，不会为了学校名头乱冲。"
    return "你现在走的是均衡路线，学校平台和专业方向都会一起考虑。"


def _infer_focus_mode(follow_up: str) -> str:
    text = follow_up.lower()
    if any(keyword in text for keyword in ["就业", "工资", "找工作", "前景", "发展"]):
        return "就业导向"
    if any(keyword in text for keyword in ["城市", "上海", "深圳", "杭州", "南京", "一线", "新一线"]):
        return "城市导向"
    if any(keyword in text for keyword in ["专业", "计算机", "电子", "自动化", "金融", "电气", "物流"]):
        return "专业导向"
    if any(keyword in text for keyword in ["调剂", "风险", "避坑", "稳", "保守"]):
        return "风险导向"
    if any(keyword in text for keyword in ["比较", "哪个好", "怎么选", "排序", "对比"]):
        return "比较决策"
    return "综合判断"


def _build_focus_rules(focus_mode: str) -> str:
    rules = {
        "就业导向": "重点比较就业口径、行业认可度、实习资源和毕业去向，不要泛泛谈学校名气。",
        "城市导向": "重点比较城市产业资源、实习便利度和毕业去向半径，要明确说哪个城市更值。",
        "专业导向": "重点比较专业硬度、课程含金量、未来岗位，不要只谈学校名头。",
        "风险导向": "重点讲冲稳保边界、调剂风险和容易踩坑的地方，要明确提醒别赌什么。",
        "比较决策": "必须给出更推荐谁、为什么，尽量给出先后顺序。",
        "综合判断": "保持均衡，但仍然要给明确倾向，不能平均用力。",
    }
    return rules.get(focus_mode, rules["综合判断"])


def _build_compare_rules(request: ExplainRequest) -> str:
    if request.analysis_mode != "compare":
        return "本轮不是显式比较模式，保持正常分析。"
    count = len(request.recommendations)
    return (
        f"当前是 {count} 选一比较模式。必须明确给出推荐顺序，"
        "说清楚谁最适合当前用户，谁更适合作为备选，谁只适合当保底。"
    )


def _mock_focus_line(
    focus_mode: str,
    request: ExplainRequest,
    top,
    second,
) -> str:
    if focus_mode == "就业导向":
        return f" 你这轮更该盯就业，不是谁名头更响，而是谁毕业以后更容易接到活。像 {top.school_name} 这种方向，胜在出口更实。"
    if focus_mode == "城市导向":
        return f" 你这轮更该看城市资源，{top.city} 这种地方最大的好处不是好听，是实习和校招更近。"
    if focus_mode == "专业导向":
        return f" 你这轮更该盯专业本身，{top.major_name} 这种方向如果学校支撑够，后续转就业会比空有牌子更有用。"
    if focus_mode == "风险导向":
        return " 你这轮最该看的不是幻想值，而是别踩坑，尤其是调剂和冲档边界。"
    if focus_mode == "比较决策" and second is not None:
        return f" 如果把它和 {second.school_name} 放一起比，我暂时更偏向前者，因为它更像一条主线，不是热闹选项。"
    return ""


def _mock_compare_line(request: ExplainRequest, top, second) -> str:
    if request.analysis_mode != "compare" or second is None:
        return ""
    return f" 这轮本质上是做选择题，不是做信息题。如果只能二选一，我会先压 {top.school_name}，再看 {second.school_name}。"
