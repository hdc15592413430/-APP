import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { API_BASE_URL, getApiBaseUrlHelpText, hasApiBaseUrl } from "./apiConfig";

type UserProfile = {
  province: string;
  score: string;
  rank: string;
  subject_track: string;
  preferred_cities: string[];
  preferred_majors: string[];
  school_focus: "名校导向" | "行业强校" | "区域重点" | "应用导向" | null;
  city_focus: "一线/新一线" | "省会优先" | "城市不是第一位" | null;
  career_goal: string;
  strategy_mode: "均衡" | "学校优先" | "专业优先";
  risk_preference: "保守" | "均衡" | "冲刺";
  accepts_adjustment: boolean;
};

type RecommendationItem = {
  tier: "冲" | "稳" | "保";
  school_name: string;
  city: string;
  major_name: string;
  match_score: number;
  rank_window: string;
  reasoning: string[];
  risk_hint: string;
  batch: string;
  reference_year: number;
  school_tier: string;
};

type DataStatus = {
  source_name: string;
  source_type: "demo" | "real";
  updated_at?: string | null;
  notes?: string | null;
  matched_record_count: number;
};

type RecommendationOverview = {
  strategy_summary: string;
  next_action: string;
  tier_counts: Record<"冲" | "稳" | "保", number>;
};

type FinalPlanItem = {
  order: number;
  tier: "冲" | "稳" | "保";
  school_name: string;
  major_name: string;
  city: string;
  match_score: number;
  fill_reason: string;
};

type FinalPlan = {
  summary: string;
  fill_strategy: string;
  items: FinalPlanItem[];
  reminder: string;
};

type ExplainResponse = {
  answer: string;
  mode: "mock" | "openclaw";
};

type FlowStage = "intake" | "confirm" | "followup" | "results";

const PROVINCES = ["河南", "山东", "河北", "江苏", "广东", "浙江", "四川"];
const TRACKS = ["物理类", "历史类", "理科", "文科"];
const GOALS = ["就业优先", "考研优先", "城市优先"];
const STRATEGY_MODES = ["均衡", "学校优先", "专业优先"] as const;
const RISK_PREFERENCES = ["保守", "均衡", "冲刺"] as const;
const SCHOOL_FOCUS_OPTIONS = ["名校导向", "行业强校", "区域重点", "应用导向"] as const;
const CITY_FOCUS_OPTIONS = ["一线/新一线", "省会优先", "城市不是第一位"] as const;
const CITY_SUGGESTIONS = ["南京", "杭州", "上海", "深圳", "武汉", "成都"];
const MAJOR_SUGGESTIONS = ["计算机", "电子信息", "自动化", "金融", "电气", "物流"];
const INTAKE_STEPS = [
  {
    key: "province",
    title: "先别急着看学校，你先告诉我，你是哪个省的考生？",
    description: "省份不定，后面很多判断都容易跑偏。",
  },
  {
    key: "score_rank",
    title: "分数和位次先亮出来，我先看你大概站在哪一档。",
    description: "这一问不需要完美，只要先把底牌说准。",
  },
  {
    key: "subject_track",
    title: "你走的是物理、历史，还是老高考文理科？这一步不能错。",
    description: "赛道没搞清，后面很多专业连门都进不去。",
  },
  {
    key: "strategy_mode",
    title: "我先问句实在的，你更怕学校不够体面，还是更怕专业读着难受？",
    description: "先把这个取舍问透，后面才是真决策，不是看热闹。",
  },
  {
    key: "career_goal",
    title: "你以后更想先解决就业、考研，还是先拿城市资源？",
    description: "同样的分数，目标一换，推荐方向会差很多。",
  },
  {
    key: "accepts_adjustment",
    title: "调剂这件事你到底能不能接受？咱们先说透。",
    description: "这个问题不说明白，后面冲稳保很容易看着热闹、实际翻车。",
  },
  {
    key: "risk_preference",
    title: "最后问一句，你是想稳一点，还是愿意留几张牌去冲？",
    description: "这里没有标准答案，关键是方案得跟你的节奏匹配。",
  },
] as const;
const ANALYSIS_PROMPTS = [
  "按就业角度讲清楚，哪几个更值得优先报？",
  "如果我想去大城市，哪些方案更现实？",
  "从专业发展看，哪些选择后劲更足？",
  "不接受调剂的话，我最该避开什么坑？",
];
const COMPARE_PROMPTS = [
  "这几个里谁最值，给我一个先后顺序。",
  "如果只能选一个，最推荐哪个？",
  "按就业和城市资源综合看，怎么排？",
];
const DECISION_OPTIONS = {
  strategy_mode: [
    { label: "均衡", description: "适合还没想完全清楚的人，先别把自己锁死在一个方向里。" },
    { label: "学校优先", description: "适合更在意平台、城市资源和学校招牌的人。" },
    { label: "专业优先", description: "适合已经知道自己不想拿专业去赌的人。" },
  ],
  career_goal: [
    { label: "就业优先", description: "后面重点看行业口径、城市资源和毕业去向。" },
    { label: "考研优先", description: "后面会更看升学氛围、保研考研环境和继续深造空间。" },
    { label: "城市优先", description: "后面会优先看城市层级，再看学校和专业怎么取舍。" },
  ],
  risk_preference: [
    { label: "保守", description: "先保证能落地，不轻易拿最后结果冒险。" },
    { label: "均衡", description: "既保留上限，也要守住底线，适合大多数人。" },
    { label: "冲刺", description: "愿意多留一点上限空间，但要接受波动更大。" },
  ],
  school_focus: [
    { label: "名校导向", description: "更看学校招牌和平台感，适合特别在意学校名头的人。" },
    { label: "行业强校", description: "更看行业认可度，很多时候比单纯名头更实际。" },
    { label: "区域重点", description: "适合更想在某个省份或区域稳定发展的选择。" },
    { label: "应用导向", description: "更看就业落地和应用能力培养，不一定追最响的名字。" },
  ],
  city_focus: [
    { label: "一线/新一线", description: "更看城市资源、实习机会和就业平台，但门槛通常更高。" },
    { label: "省会优先", description: "城市资源和性价比更平衡，很多人最后会落在这类城市。" },
    { label: "城市不是第一位", description: "先把学校和专业看清，不拿城市当第一决策点。" },
  ],
} as const;

const initialProfile: UserProfile = {
  province: "河南",
  score: "",
  rank: "",
  subject_track: "物理类",
  preferred_cities: [],
  preferred_majors: [],
  school_focus: null,
  city_focus: null,
  career_goal: "就业优先",
  strategy_mode: "均衡",
  risk_preference: "均衡",
  accepts_adjustment: false,
};

export default function App() {
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [flowStage, setFlowStage] = useState<FlowStage>("intake");
  const [intakeStep, setIntakeStep] = useState(0);
  const [followupStep, setFollowupStep] = useState(0);
  const [scrollSignal, setScrollSignal] = useState(0);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [analysis, setAnalysis] = useState<ExplainResponse | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [overview, setOverview] = useState<RecommendationOverview | null>(null);
  const [finalPlan, setFinalPlan] = useState<FinalPlan | null>(null);
  const [question, setQuestion] = useState("我想优先去一线或新一线城市，有没有更稳的选择？");
  const [selectedRecommendationKeys, setSelectedRecommendationKeys] = useState<string[]>([]);
  const [expandedRecommendationKey, setExpandedRecommendationKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingReco, setLoadingReco] = useState(false);
  const [loadingExplain, setLoadingExplain] = useState(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const intakeQuestionYRef = useRef(0);
  const followupQuestionYRef = useRef(0);
  const resultsSectionYRef = useRef(0);
  const pendingScrollTargetRef = useRef<"intake" | "followup" | "results" | null>(null);

  const summary = useMemo(() => {
    const citySummary = profile.preferred_cities.join(" / ") || "暂未选择城市";
    const majorSummary = profile.preferred_majors.join(" / ") || "暂未选择专业";
    const cityFocusSummary = profile.city_focus ? ` · 城市取向 ${profile.city_focus}` : "";
    const schoolFocusSummary = profile.school_focus ? ` · 平台偏好 ${profile.school_focus}` : "";
    return `${profile.province} · ${profile.subject_track} · ${profile.strategy_mode}/${profile.risk_preference}${cityFocusSummary}${schoolFocusSummary} · 城市 ${citySummary} · 专业 ${majorSummary}`;
  }, [profile]);

  const currentIntakeStep = INTAKE_STEPS[intakeStep];
  const canSubmit = Boolean(profile.score.trim() && profile.rank.trim());
  const intakeSummaryItems = useMemo(() => buildIntakeSummaryItems(profile), [profile]);
  const selectedRecommendations = recommendations.filter((item) =>
    selectedRecommendationKeys.includes(buildRecommendationKey(item)),
  );
  const isCompareMode = selectedRecommendations.length >= 2;
  const activePromptList = isCompareMode ? COMPARE_PROMPTS : ANALYSIS_PROMPTS;
  const intakeError = getIntakeValidationMessage(currentIntakeStep.key, profile);
  const intakeProgress = ((intakeStep + 1) / INTAKE_STEPS.length) * 100;
  const hasRecommendationResult = Boolean(dataStatus || overview || finalPlan || recommendations.length);
  const followupSteps = getFollowupSteps(profile);
  const currentFollowupStepIndex = Math.min(followupStep, Math.max(followupSteps.length - 1, 0));
  const currentFollowupStep = followupSteps[currentFollowupStepIndex] ?? null;
  const followupProgress = followupSteps.length
    ? ((currentFollowupStepIndex + 1) / followupSteps.length) * 100
    : 0;
  const followupSummary = buildFollowupSummary(profile);
  const showFollowupStage = flowStage === "followup" && hasRecommendationResult;
  const showResultsStage = flowStage === "results" && hasRecommendationResult;
  const mergedPlanItems =
    finalPlan?.items ??
    recommendations.map((item, index) => ({
      order: index + 1,
      tier: item.tier,
      school_name: item.school_name,
      major_name: item.major_name,
      city: item.city,
      match_score: item.match_score,
      fill_reason: `${item.tier}档候选，当前按匹配分和档位顺序先给出一版默认排法。`,
    }));

  useEffect(() => {
    const target = pendingScrollTargetRef.current;
    if (!target) {
      return;
    }

    pendingScrollTargetRef.current = null;
    requestAnimationFrame(() => {
      const scrollY =
        target === "intake"
          ? intakeQuestionYRef.current
          : target === "followup"
            ? followupQuestionYRef.current
            : resultsSectionYRef.current;
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, scrollY - 16),
        animated: true,
      });
    });
  }, [scrollSignal]);

  function requestScroll(target: "intake" | "followup" | "results") {
    pendingScrollTargetRef.current = target;
    setScrollSignal((current) => current + 1);
  }

  function scheduleScroll(target: "intake" | "followup" | "results") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestScroll(target);
      });
    });
  }

  function goToNextIntakeStep() {
    if (intakeError) {
      setError(intakeError);
      return;
    }

    setError(null);
    setIntakeStep((current) => Math.min(current + 1, INTAKE_STEPS.length - 1));
    requestScroll("intake");
  }

  function goToPreviousIntakeStep() {
    setError(null);
    setIntakeStep((current) => Math.max(current - 1, 0));
  }

  function goToNextFollowupStep() {
    setError(null);
    setFollowupStep((current) => Math.min(current + 1, Math.max(followupSteps.length - 1, 0)));
    requestScroll("followup");
  }

  function goToPreviousFollowupStep() {
    setError(null);
    setFollowupStep((current) => Math.max(current - 1, 0));
  }

  function openIntakeConfirmation() {
    if (intakeError) {
      setError(intakeError);
      return;
    }

    if (!canSubmit) {
      setError("请先填写分数和位次。");
      return;
    }

    setError(null);
    setFlowStage("confirm");
    scheduleScroll("intake");
  }

  async function handleRecommend(options?: {
    scrollTarget?: "followup" | "results";
    nextStage?: FlowStage;
  }) {
    if (!hasApiBaseUrl()) {
      setError(getApiBaseUrlHelpText() ?? "当前还没配置接口地址。");
      return false;
    }

    if (!canSubmit) {
      setError("请先填写分数和位次。");
      return false;
    }

    setError(null);
    setAnalysis(null);
    setDataStatus(null);
    setOverview(null);
    setFinalPlan(null);
    setLoadingReco(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/recommendations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: normalizeProfile(profile),
        }),
      });

      if (!response.ok) {
        throw new Error(`recommendations failed: ${response.status}`);
      }

      const data = await response.json();
      setRecommendations(data.recommendations ?? []);
      setSelectedRecommendationKeys([]);
      setExpandedRecommendationKey(null);
      setFollowupStep(0);
      setDataStatus(data.data_status ?? null);
      setOverview(data.overview ?? null);
      setFinalPlan(data.final_plan ?? null);
      if (options?.nextStage) {
        setFlowStage(options.nextStage);
      }
      if (options?.scrollTarget) {
        scheduleScroll(options.scrollTarget);
      }
      return true;
    } catch (requestError) {
      setError("推荐接口暂时不可用，请先确认后端已经启动，并检查手机是否能访问电脑 IP。");
      console.error(requestError);
      return false;
    } finally {
      setLoadingReco(false);
    }
  }

  async function handleExplain() {
    if (!hasApiBaseUrl()) {
      setError(getApiBaseUrlHelpText() ?? "当前还没配置接口地址。");
      return;
    }

    if (recommendations.length === 0) {
      setError("先生成一版冲稳保方案，再继续追问。");
      return;
    }

    if (isCompareMode && selectedRecommendations.length < 2) {
      setError("至少勾选 2 个候选项，再生成比较决策。");
      return;
    }

    setError(null);
    setLoadingExplain(true);

    try {
      const analysisRecommendations = isCompareMode ? selectedRecommendations : recommendations;
      const analysisMode = isCompareMode ? "compare" : "general";
      const response = await fetch(`${API_BASE_URL}/api/explanations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: normalizeProfile(profile),
          recommendations: analysisRecommendations,
          focus_question: question.trim() || undefined,
          analysis_mode: analysisMode,
        }),
      });

      if (!response.ok) {
        throw new Error(`explanations failed: ${response.status}`);
      }

      const data: ExplainResponse = await response.json();
      setAnalysis(data);
    } catch (requestError) {
      setError("风格化解释接口暂时不可用，先确认 API 正在运行。");
      console.error(requestError);
    } finally {
      setLoadingExplain(false);
    }
  }

  function toggleRecommendationSelection(item: RecommendationItem) {
    const key = buildRecommendationKey(item);
    setSelectedRecommendationKeys((current) => {
      if (current.includes(key)) {
        return current.filter((entry) => entry !== key);
      }
      if (current.length >= 3) {
        return [...current.slice(1), key];
      }
      return [...current, key];
    });
  }

  function toggleRecommendationDetails(planItem: FinalPlanItem) {
    const key = buildPlanLookupKey(planItem);
    setExpandedRecommendationKey((current) => (current === key ? null : key));
  }

  function renderIntakeStep() {
    switch (currentIntakeStep.key) {
      case "province":
        return (
          <ChipRow
            label="选择省份"
            options={PROVINCES}
            selected={[profile.province]}
            onToggle={(value) => setProfile((current) => ({ ...current, province: value }))}
            single
          />
        );
      case "score_rank":
        return (
          <View style={styles.row}>
            <Field
              label="分数"
              keyboardType="numeric"
              value={profile.score}
              onChangeText={(value) => setProfile((current) => ({ ...current, score: value }))}
              placeholder="例如 600"
            />
            <Field
              label="位次"
              keyboardType="numeric"
              value={profile.rank}
              onChangeText={(value) => setProfile((current) => ({ ...current, rank: value }))}
              placeholder="例如 12000"
            />
          </View>
        );
      case "subject_track":
        return (
          <ChipRow
            label="选择科类 / 选科"
            options={TRACKS}
            selected={[profile.subject_track]}
            onToggle={(value) => setProfile((current) => ({ ...current, subject_track: value }))}
            single
          />
        );
      case "strategy_mode":
        return (
          <DecisionOptions
            label="先定决策取向"
            options={[...DECISION_OPTIONS.strategy_mode]}
            selected={profile.strategy_mode}
            onSelect={(value) =>
              setProfile((current) => ({
                ...current,
                strategy_mode: value as UserProfile["strategy_mode"],
              }))
            }
          />
        );
      case "career_goal":
        return (
          <DecisionOptions
            label="先定长期目标"
            options={[...DECISION_OPTIONS.career_goal]}
            selected={profile.career_goal}
            onSelect={(value) => setProfile((current) => ({ ...current, career_goal: value }))}
          />
        );
      case "accepts_adjustment":
        return (
          <View style={styles.binaryGroup}>
            <Pressable
              style={[
                styles.binaryOption,
                profile.accepts_adjustment ? styles.binaryOptionActive : null,
              ]}
              onPress={() =>
                setProfile((current) => ({
                  ...current,
                  accepts_adjustment: true,
                }))
              }
            >
              <Text
                style={[
                  styles.binaryTitle,
                  profile.accepts_adjustment ? styles.binaryTitleActive : null,
                ]}
              >
                可以接受调剂
              </Text>
              <Text
                style={[
                  styles.binaryBody,
                  profile.accepts_adjustment ? styles.binaryBodyActive : null,
                ]}
              >
                换更大的选择空间，冲稳保结构会更灵活。
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.binaryOption,
                !profile.accepts_adjustment ? styles.binaryOptionActive : null,
              ]}
              onPress={() =>
                setProfile((current) => ({
                  ...current,
                  accepts_adjustment: false,
                }))
              }
            >
              <Text
                style={[
                  styles.binaryTitle,
                  !profile.accepts_adjustment ? styles.binaryTitleActive : null,
                ]}
              >
                尽量不接受调剂
              </Text>
              <Text
                style={[
                  styles.binaryBody,
                  !profile.accepts_adjustment ? styles.binaryBodyActive : null,
                ]}
              >
                更强调专业可控性，但保底志愿要放扎实。
              </Text>
            </Pressable>
          </View>
        );
      case "risk_preference":
        return (
          <DecisionOptions
            label="选择你的节奏"
            options={[...DECISION_OPTIONS.risk_preference]}
            selected={profile.risk_preference}
            onSelect={(value) =>
              setProfile((current) => ({
                ...current,
                risk_preference: value as UserProfile["risk_preference"],
              }))
            }
          />
        );
      default:
        return null;
    }
  }

  function renderFollowupStep() {
    if (!currentFollowupStep) {
      return null;
    }

    switch (currentFollowupStep.key) {
      case "school_focus":
        return (
          <DecisionOptions
            label="你更想靠近哪类学校平台？"
            options={[...DECISION_OPTIONS.school_focus]}
            selected={profile.school_focus}
            onSelect={(value) =>
              setProfile((current) => ({
                ...current,
                school_focus: value as UserProfile["school_focus"],
              }))
            }
          />
        );
      case "city_focus":
        return (
          <DecisionOptions
            label="第二轮先把城市层级问清楚"
            options={[...DECISION_OPTIONS.city_focus]}
            selected={profile.city_focus}
            onSelect={(value) =>
              setProfile((current) => ({
                ...current,
                city_focus: value as UserProfile["city_focus"],
              }))
            }
          />
        );
      case "preferred_cities":
        return (
          <ChipRow
            label="如果要再具体一点，你更想去哪几个城市？"
            options={getCitySuggestionsByFocus(profile.city_focus)}
            selected={profile.preferred_cities}
            onToggle={(value) =>
              setProfile((current) => ({
                ...current,
                preferred_cities: toggleItem(current.preferred_cities, value),
              }))
            }
          />
        );
      case "preferred_majors":
        return (
          <ChipRow
            label="你更想靠近哪些专业方向？"
            options={MAJOR_SUGGESTIONS}
            selected={profile.preferred_majors}
            onToggle={(value) =>
              setProfile((current) => ({
                ...current,
                preferred_majors: toggleItem(current.preferred_majors, value),
              }))
            }
          />
        );
      default:
        return null;
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={styles.flex}
      >
        <ScrollView ref={scrollViewRef} style={styles.flex} contentContainerStyle={styles.container}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>高考志愿辅助顾问 MVP</Text>
            <Text style={styles.heroTitle}>先像顾问一样发问，再把建议一步步收窄</Text>
            <Text style={styles.heroBody}>先回答关键问题，再看建议。</Text>
            <Text style={styles.heroMeta}>{summary}</Text>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>
                {dataStatus?.source_type === "real"
                  ? `数据源：${dataStatus.source_name}`
                  : "演示数据"}
              </Text>
            </View>
          </View>

          {flowStage === "intake" ? (
            <Card title="1. 顾问式引导" subtitle="先把最关键的底牌问清。">
              <View style={styles.guideHeader}>
                <Text style={styles.guideStepText}>
                  第 {intakeStep + 1} / {INTAKE_STEPS.length} 问
                </Text>
                <Text style={styles.guideStepHint}>先别急着看学校名字。</Text>
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${intakeProgress}%` }]} />
              </View>

              <View
                style={styles.questionCard}
                onLayout={(event) => {
                  intakeQuestionYRef.current = event.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.questionTitle}>{currentIntakeStep.title}</Text>
                <Text style={styles.questionBody}>{currentIntakeStep.description}</Text>
                {renderIntakeStep()}
                <CoachDecisionPanel stepKey={currentIntakeStep.key} profile={profile} phase="intake" />
              </View>

              <View style={styles.flowActions}>
                <Pressable
                  style={[styles.ghostButton, intakeStep === 0 ? styles.ghostButtonDisabled : null]}
                  onPress={goToPreviousIntakeStep}
                  disabled={intakeStep === 0}
                >
                  <Text
                    style={[
                      styles.ghostButtonText,
                      intakeStep === 0 ? styles.ghostButtonTextDisabled : null,
                    ]}
                  >
                    上一问
                  </Text>
                </Pressable>

                {intakeStep === INTAKE_STEPS.length - 1 ? (
                  <Pressable style={[styles.primaryButton, styles.flowPrimaryButton]} onPress={openIntakeConfirmation}>
                    <Text style={styles.primaryButtonText}>查看信息汇总</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[styles.primaryButton, styles.flowPrimaryButton]} onPress={goToNextIntakeStep}>
                    <Text style={styles.primaryButtonText}>继续下一问</Text>
                  </Pressable>
                )}
              </View>
            </Card>
          ) : null}

          {flowStage === "confirm" ? (
            <Card title="1. 信息汇总" subtitle="确认无误后，再进入第二部分。">
              <View
                style={styles.questionCard}
                onLayout={(event) => {
                  intakeQuestionYRef.current = event.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.confirmLead}>先确认这版底牌没问题，我再按这个口径继续往下问。</Text>
                {intakeSummaryItems.map((item) => (
                  <View key={item.label} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{item.label}</Text>
                    <Text style={styles.summaryValue}>{item.value}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.flowActions}>
                <Pressable
                  style={[styles.ghostButton, styles.flowPrimaryButton]}
                  onPress={() => {
                    setFlowStage("intake");
                    scheduleScroll("intake");
                  }}
                >
                  <Text style={styles.ghostButtonText}>返回修改</Text>
                </Pressable>

                <Pressable
                  style={[styles.primaryButton, styles.flowPrimaryButton]}
                  onPress={() => handleRecommend({ scrollTarget: "followup", nextStage: "followup" })}
                >
                  {loadingReco ? (
                    <ActivityIndicator color="#FFF8F2" />
                  ) : (
                    <Text style={styles.primaryButtonText}>确认无误，进入第二部分</Text>
                  )}
                </Pressable>
              </View>
            </Card>
          ) : null}

          {showFollowupStage ? (
            <Card
              title="2. 继续追问"
              subtitle="我按你前面的回答继续往下问。"
            >
              <View style={styles.guideHeader}>
                <Text style={styles.guideStepText}>
                  第 {currentFollowupStepIndex + 1} / {followupSteps.length} 轮追问
                </Text>
                <Text style={styles.guideStepHint}>{followupSummary}</Text>
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${followupProgress}%` }]} />
              </View>

              {currentFollowupStep ? (
                <View
                  style={styles.questionCard}
                  onLayout={(event) => {
                    followupQuestionYRef.current = event.nativeEvent.layout.y;
                  }}
                >
                  <Text style={styles.questionTitle}>{currentFollowupStep.title}</Text>
                  <Text style={styles.questionBody}>{currentFollowupStep.description}</Text>
                  {renderFollowupStep()}
                  <CoachDecisionPanel stepKey={currentFollowupStep.key} profile={profile} phase="followup" />
                </View>
              ) : null}

              <View style={styles.flowActions}>
                <Pressable
                  style={[
                    styles.ghostButton,
                    currentFollowupStepIndex === 0 ? styles.ghostButtonDisabled : null,
                  ]}
                  onPress={goToPreviousFollowupStep}
                  disabled={currentFollowupStepIndex === 0}
                >
                  <Text
                    style={[
                      styles.ghostButtonText,
                      currentFollowupStepIndex === 0 ? styles.ghostButtonTextDisabled : null,
                    ]}
                  >
                    上一问
                  </Text>
                </Pressable>

                {currentFollowupStepIndex === followupSteps.length - 1 ? (
                  <Pressable
                    style={[styles.secondaryButton, styles.flowPrimaryButton]}
                    onPress={() =>
                      handleRecommend({
                        scrollTarget: "results",
                        nextStage: "results",
                      })
                    }
                  >
                    {loadingReco ? (
                      <ActivityIndicator color="#5C2B15" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>按这一轮回答刷新建议</Text>
                    )}
                  </Pressable>
                ) : (
                  <Pressable style={[styles.secondaryButton, styles.flowPrimaryButton]} onPress={goToNextFollowupStep}>
                    <Text style={styles.secondaryButtonText}>继续追问</Text>
                  </Pressable>
                )}
              </View>
            </Card>
          ) : null}

          {showResultsStage ? (
            <Card
              title="3. 推荐结果"
              subtitle="先看顺序，点开看细节。"
            >
            <View
              onLayout={(event) => {
                resultsSectionYRef.current = event.nativeEvent.layout.y;
              }}
            />
            {dataStatus ? (
              <View style={[styles.dataBanner, dataStatus.source_type === "real" ? styles.dataBannerReal : null]}>
                <Text style={styles.dataBannerTitle}>
                  {dataStatus.source_type === "real" ? "已接入真实数据源" : "当前为演示数据"}
                </Text>
                <Text style={styles.dataBannerBody}>
                  来源：{dataStatus.source_name}
                  {dataStatus.updated_at ? ` · 更新日期 ${dataStatus.updated_at}` : ""}
                  {` · 当前匹配到 ${dataStatus.matched_record_count} 条记录`}
                </Text>
                {dataStatus.notes ? <Text style={styles.dataBannerNote}>{dataStatus.notes}</Text> : null}
              </View>
            ) : null}

            {overview ? (
              <View style={styles.overviewCard}>
                <Text style={styles.overviewTitle}>方案解读</Text>
                <Text style={styles.overviewBody}>{overview.strategy_summary}</Text>
                <Text style={styles.overviewCounts}>
                  冲 {overview.tier_counts["冲"]} · 稳 {overview.tier_counts["稳"]} · 保 {overview.tier_counts["保"]}
                </Text>
                <Text style={styles.overviewNext}>{overview.next_action}</Text>
              </View>
            ) : null}

            {recommendations.length === 0 ? (
              <Text style={styles.placeholder}>
                还没有推荐结果。先填写分数和位次，点上面的按钮生成第一版方案。
              </Text>
            ) : (
              <View style={styles.planCard}>
                {finalPlan ? (
                  <>
                    <Text style={styles.planTitle}>建议填报顺序</Text>
                    <Text style={styles.planToggleHint}>点开查看详情，再点一次收起。</Text>
                  </>
                ) : null}

                <View style={styles.planList}>
                  {mergedPlanItems.map((planItem) => {
                    const recommendation = findRecommendationForPlanItem(planItem, recommendations);
                    const expanded = expandedRecommendationKey === buildPlanLookupKey(planItem);
                    const selected =
                      recommendation !== undefined &&
                      selectedRecommendationKeys.includes(buildRecommendationKey(recommendation));

                    return (
                      <View
                        key={`${planItem.order}-${planItem.school_name}-${planItem.major_name}`}
                        style={[
                          styles.mergedCard,
                          expanded ? styles.mergedCardExpanded : null,
                          selected ? styles.resultCardSelected : null,
                        ]}
                      >
                        <Pressable onPress={() => toggleRecommendationDetails(planItem)} style={styles.mergedCardPressable}>
                          <View style={styles.planItem}>
                            <View style={styles.planOrderBadge}>
                              <Text style={styles.planOrderText}>{planItem.order}</Text>
                            </View>
                            <View style={styles.planItemCopy}>
                              <Text style={styles.planItemTitle}>
                                {planItem.tier}档 · {planItem.school_name} · {planItem.major_name}
                              </Text>
                              <Text style={styles.planItemMeta}>
                                {planItem.city} · 匹配分 {planItem.match_score}
                              </Text>
                              <Text style={styles.planItemReason}>{planItem.fill_reason}</Text>
                              <Text style={styles.planExpandText}>
                                {expanded ? "点一下收起详细信息" : "点一下查看详细依据"}
                              </Text>
                            </View>
                          </View>
                        </Pressable>

                        {expanded && recommendation ? (
                          <View style={styles.mergedDetail}>
                            <Text style={styles.resultSubTitle}>
                              {recommendation.batch} · 参考年份 {recommendation.reference_year} · 位次区间{" "}
                              {recommendation.rank_window} · 学校定位 {recommendation.school_tier}
                            </Text>

                            {recommendation.reasoning.map((reason) => (
                              <Text key={reason} style={styles.reasoningText}>
                                {reason}
                              </Text>
                            ))}

                            <Text style={styles.riskHint}>{recommendation.risk_hint}</Text>

                            <Pressable
                              style={[
                                styles.compareToggleButton,
                                selected ? styles.compareToggleButtonActive : null,
                              ]}
                              onPress={() => toggleRecommendationSelection(recommendation)}
                            >
                              <Text
                                style={[
                                  styles.compareToggleText,
                                  selected ? styles.compareToggleTextActive : null,
                                ]}
                              >
                                {selected ? "已加入比较决策，点一下取消" : "加入比较决策"}
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>

                {finalPlan ? <Text style={styles.planReminder}>{finalPlan.reminder}</Text> : null}
              </View>
            )}
            </Card>
          ) : null}

          {showResultsStage ? (
            <Card title="4. 风格化分析" subtitle="需要时再继续深问。">
            <Text style={styles.analysisTip}>
              优先问：谁更值、怎么排、哪个更稳。
            </Text>

            <View style={styles.analysisModeBanner}>
              <Text style={styles.analysisModeTitle}>
                {isCompareMode ? "当前是比较决策模式" : "当前是普通追问模式"}
              </Text>
              <Text style={styles.analysisModeBody}>
                {isCompareMode
                  ? `你已选 ${selectedRecommendations.length} 个候选项：${selectedRecommendations
                      .map((item) => item.school_name)
                      .join(" / ")}`
                  : "如果想让系统直接帮你二选一或三选一，可以先在上面的推荐卡片里点选 2 到 3 个候选项。"}
              </Text>
            </View>

            <Field
              label={isCompareMode ? "比较追问" : "继续追问"}
              value={question}
              onChangeText={setQuestion}
              placeholder={
                isCompareMode
                  ? "例如：这几个里谁最值，给我一个先后顺序。"
                  : "例如：我想去杭州或南京，优先保就业，怎么选？"
              }
              multiline
            />

            <View style={styles.chipGroup}>
              <Text style={styles.fieldLabel}>{isCompareMode ? "比较快捷追问" : "快捷追问"}</Text>
              <View style={styles.chipWrap}>
                {activePromptList.map((prompt) => {
                  const active = question === prompt;
                  return (
                    <Pressable
                      key={prompt}
                      style={[styles.quickAskChip, active ? styles.quickAskChipActive : null]}
                      onPress={() => setQuestion(prompt)}
                    >
                      <Text style={[styles.quickAskText, active ? styles.quickAskTextActive : null]}>
                        {prompt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable style={styles.secondaryButton} onPress={handleExplain}>
              {loadingExplain ? (
                <ActivityIndicator color="#5C2B15" />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  {isCompareMode ? "生成比较决策" : "生成张雪峰式分析"}
                </Text>
              )}
            </Pressable>

            {analysis ? (
              <View style={styles.analysisCard}>
                <Text style={styles.analysisTitle}>
                  分析结果 {analysis.mode === "openclaw" ? "· 已连接 OpenClaw" : "· 模拟风格模式"}
                </Text>
                <Text style={styles.analysisBody}>{analysis.answer}</Text>
                <Text style={styles.analysisNote}>
                  {analysis.mode === "openclaw"
                    ? "当前已经在走你的真实风格链路，可以继续围绕城市、专业和调剂做深挖追问。"
                    : "当前是模拟风格模式，卖点演示已经能跑通；接上 OpenClaw 后，分析会替换成你的真实 skill 输出。"}
                </Text>
              </View>
            ) : (
              <Text style={styles.placeholder}>这里显示分析结果。</Text>
            )}
            </Card>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function normalizeProfile(profile: UserProfile) {
  return {
    ...profile,
    score: Number(profile.score),
    rank: Number(profile.rank),
  };
}

function buildRecommendationKey(item: RecommendationItem) {
  return `${item.tier}-${item.school_name}-${item.major_name}-${item.reference_year}`;
}

function buildPlanLookupKey(item: Pick<FinalPlanItem, "tier" | "school_name" | "major_name" | "city">) {
  return `${item.tier}-${item.school_name}-${item.major_name}-${item.city}`;
}

function findRecommendationForPlanItem(
  planItem: FinalPlanItem,
  recommendations: RecommendationItem[],
) {
  return recommendations.find(
    (item) =>
      item.tier === planItem.tier &&
      item.school_name === planItem.school_name &&
      item.major_name === planItem.major_name &&
      item.city === planItem.city,
  );
}

function toggleItem(items: string[], value: string) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function uniqueLines(...lines: Array<string | null | undefined>) {
  const normalized: string[] = [];

  lines.forEach((line) => {
    const value = line?.trim();
    if (!value || normalized.includes(value)) {
      return;
    }
    normalized.push(value);
  });

  return normalized;
}

function getFollowupSteps(profile: UserProfile) {
  const steps: Array<{
    key: "school_focus" | "city_focus" | "preferred_cities" | "preferred_majors";
    title: string;
    description: string;
  }> = [];

  if (profile.strategy_mode === "学校优先") {
    steps.push({
      key: "school_focus",
      title: "既然你更看学校，那你要的到底是哪种平台？",
      description: "别只说想要好学校，得说清你认的是招牌、行业，还是区域资源。",
    });
  } else if (profile.strategy_mode === "专业优先") {
    steps.push({
      key: "preferred_majors",
      title: "既然你更看专业，那我先不聊学校名头，先把方向圈出来。",
      description: "不用一次定死，先把最想靠近的 1 到 3 个方向说清就够了。",
    });
  } else if (profile.career_goal === "城市优先") {
    steps.push({
      key: "city_focus",
      title: "你说城市重要，那我得追一句：你非一线新一线不可吗？",
      description: "先把城市层级讲透，再决定要不要往具体城市收。",
    });
  } else {
    steps.push({
      key: "preferred_majors",
      title: "我先追一句专业方向，你现在最愿意往哪几个选择靠？",
      description: "这一步不是让你定终身，只是先把真正想看的方向问出来。",
    });
  }

  if (
    (profile.career_goal === "城市优先" || profile.strategy_mode === "学校优先") &&
    !steps.some((step) => step.key === "city_focus")
  ) {
    steps.push({
      key: "city_focus",
      title: "再追一步城市，你到底更想落在哪个层级？",
      description: "这一问会直接影响后面哪些学校看着热闹、哪些是真的合适。",
    });
  }

  steps.push({
    key: "preferred_cities",
    title: "再具体一点，真让你去，你最愿意去哪几个城市？",
    description: "先把范围收窄到你真会去的地方，后面建议才不会发散。",
  });

  if (!steps.some((step) => step.key === "preferred_majors")) {
    steps.push({
      key: "preferred_majors",
      title: "最后再追一句，你最能接受哪些专业方向？",
      description: "把这一步问清，后面我才不会只拿学校名气跟你绕。",
    });
  }

  return steps.slice(0, 3);
}

function buildFollowupSummary(profile: UserProfile) {
  if (profile.strategy_mode === "学校优先") {
    return "这轮先把平台和城市讲透。";
  }
  if (profile.strategy_mode === "专业优先") {
    return "这轮先把专业方向收紧。";
  }
  if (profile.career_goal === "城市优先") {
    return "这轮先把城市层级问透。";
  }
  return "这轮继续把关键取舍问清。";
}

function getCitySuggestionsByFocus(cityFocus: UserProfile["city_focus"]) {
  if (cityFocus === "一线/新一线") {
    return ["上海", "深圳", "杭州", "南京", "苏州", "成都"];
  }
  if (cityFocus === "省会优先") {
    return ["南京", "杭州", "武汉", "成都", "广州", "济南"];
  }
  return CITY_SUGGESTIONS;
}

function getImmediateFeedback(stepKey: string, profile: UserProfile) {
  switch (stepKey) {
    case "province":
      if (profile.province === "河南" || profile.province === "山东" || profile.province === "河北") {
        return {
          body: `${profile.province}这个赛道竞争密度不低，后面别太迷信学校名字，位次和梯度得排得更扎实。`,
          hint: "你后面如果想冲，我会更强调保底一定要放够。",
        };
      }
      return {
        body: `先按${profile.province}的逻辑来想，这一步很重要，因为别省能上的学校，不代表你这个省就能上。`,
        hint: "后面我会优先按你所在省份的口径理解冲稳保。",
      };
    case "score_rank":
      if (!profile.score.trim() || !profile.rank.trim()) {
        return null;
      }
      if (Number(profile.rank) <= 10000) {
        return {
          body: `你这个位次不算差，后面不是没得选，而是得先想清楚到底拿什么去换。`,
          hint: "别一上来只看学校名头，很多时候真正值不值在专业和城市。",
        };
      }
      if (Number(profile.rank) <= 30000) {
        return {
          body: `你这个位次属于最容易纠结的一档，看着能选的不少，但真正合适的没那么多。`,
          hint: "后面我会帮你把“能上”和“值不值”分开看。",
        };
      }
      return {
        body: `你这个位次更要少做幻想，多做取舍。先把底线守住，再谈冲不冲。`,
        hint: "后面我会把保底和可控性看得更重。",
      };
    case "subject_track":
      return profile.subject_track.includes("物理") || profile.subject_track === "理科"
        ? {
            body: "你现在的可选面相对更宽，但宽不代表都值。后面我会优先帮你筛掉看着热闹但性价比一般的路。",
            hint: "专业选择会更多，但也更容易被选择过多拖住。",
          }
        : {
            body: "你这条线更要看清学校和专业的真实适配，不是把热门名字一股脑往上堆就行。",
            hint: "后面我会更注意哪些方向是真正适合你这条赛道的。",
          };
    case "strategy_mode":
      return {
        均衡: {
          body: "你现在不想极端，这个判断其实挺成熟。后面我不会逼你只保学校或者只保专业。",
          hint: "我会同时给你留上限，也给你留退路。",
        },
        学校优先: {
          body: "你这一下就把核心矛盾说清楚了，你不是没方向，你就是更认平台。那后面我先替你看学校值不值。",
          hint: "但我也会提醒你，学校好不代表什么专业都值得读。",
        },
        专业优先: {
          body: "这个选择挺关键，说明你已经知道自己不想拿专业去换学校名气了。后面我会更尊重这个底线。",
          hint: "我不会轻易拿一个好听的校名把你专业方向带偏。",
        },
      }[profile.strategy_mode];
    case "career_goal":
      return {
        就业优先: {
          body: "那后面学校值不值，我会优先按就业口径看，不按宣传口径看。",
          hint: "城市资源、行业去向和就业强度会比学校名气更重要。",
        },
        考研优先: {
          body: "那后面我不会只盯毕业找工作快不快，而是会多看升学氛围和继续深造空间。",
          hint: "同样一所学校，对就业和考研路线的价值感是不一样的。",
        },
        城市优先: {
          body: "你其实已经在做一个很现实的选择了。那后面我会先把城市层级问清，再看学校和专业怎么配。",
          hint: "有些学校单看名气一般，但放到城市资源里就未必差。",
        },
      }[profile.career_goal];
    case "accepts_adjustment":
      return profile.accepts_adjustment
        ? {
            body: "你愿意接受调剂，方案空间会大不少，但这不代表什么调剂都能接受。",
            hint: "后面我会提醒你哪些调剂属于可接受，哪些属于明显踩坑。",
          }
        : {
            body: "你把底线说清楚了，这很好。后面我不会为了冲学校把你专业可控性赌掉。",
            hint: "保底志愿和专业顺序会比别人更重要。",
          };
    case "risk_preference":
      return {
        保守: {
          body: "你这个心态很正常，真正填报时很多人最后都会回到稳字上。后面我会先帮你守住结果。",
          hint: "我会更严格过滤那些看着刺激、其实不太落地的方案。",
        },
        均衡: {
          body: "你想要的是可攻可守，这最像真实填志愿的人。后面我会给你一版更均衡的梯度。",
          hint: "冲稳保都会留，但不会让某一档过重。",
        },
        冲刺: {
          body: "你愿意冲，那我不会拦着你，但我会把哪些是冲、哪些是赌说得很明白。",
          hint: "你可以留上限，但不能把底盘全掏空。",
        },
      }[profile.risk_preference];
    case "school_focus":
      if (!profile.school_focus) {
        return null;
      }
      return {
        body: `你现在更靠近“${profile.school_focus}”这条路，这就比一句“我想要好学校”清楚太多了。`,
        hint: "后面我会优先沿着这类平台替你筛，不会什么学校都往你眼前摆。",
      };
    case "city_focus":
      if (!profile.city_focus) {
        return null;
      }
      return {
        body: `你现在对城市的要求已经更具体了，走“${profile.city_focus}”和笼统说想去大城市，完全不是一回事。`,
        hint: "后面我会先在这个城市层级里替你看值不值，再谈学校名气。",
      };
    case "preferred_cities":
      if (!profile.preferred_cities.length) {
        return null;
      }
      return {
        body: `你已经把城市范围缩到 ${profile.preferred_cities.join(" / ")}，这一下就把很多假选择排掉了。`,
        hint: "后面我会更像在这些城市里给你挑，而不是全国到处撒网。",
      };
    case "preferred_majors":
      if (!profile.preferred_majors.length) {
        return null;
      }
      return {
        body: `你已经开始有专业方向了：${profile.preferred_majors.join(" / ")}。这比“先随便看看”强太多。`,
        hint: "后面我会优先按这些方向替你判断哪些学校是真的值，哪些只是校名好听。",
      };
    default:
      return null;
  }
}

function getStageInsight(profile: UserProfile, phase: "intake" | "followup") {
  if (phase === "intake") {
    if (!profile.score.trim() || !profile.rank.trim()) {
      return {
        title: "阶段判断",
        body: "你现在还在确认底牌阶段，先别急着谈哪个学校值，先把分数和位次说准最重要。",
      };
    }

    if (profile.strategy_mode === "专业优先") {
      return {
        title: "阶段判断",
        body: "你现在已经明显偏专业优先型了。后面我更该帮你看方向值不值，而不是拿学校名气压你。",
      };
    }

    if (profile.strategy_mode === "学校优先") {
      return {
        title: "阶段判断",
        body: "你现在已经明显偏平台型选择了。后面我得先帮你把学校层级和城市资源讲透，再谈专业妥协到哪一步。",
      };
    }

    return {
      title: "阶段判断",
      body: "你现在还在均衡摸底阶段，这不是犹豫，是正常。后面我会继续帮你把真正影响结果的偏好问出来。",
    };
  }

  if (profile.city_focus && profile.preferred_cities.length) {
    return {
      title: "阶段判断",
      body: `你现在已经不是泛泛想去大城市了，而是开始形成“${profile.city_focus} + ${profile.preferred_cities.join(" / ")}”的具体落点，这会明显改变推荐。`,
    };
  }

  if (profile.preferred_majors.length && profile.school_focus) {
    return {
      title: "阶段判断",
      body: `你现在已经把“平台偏好 + 专业方向”一起说清楚了。后面我就能更像真人顾问一样，告诉你哪里值得妥协、哪里不值得。`,
    };
  }

  return {
    title: "阶段判断",
    body: "你第二轮已经开始有真实偏好了。现在不是缺信息，而是要继续把那些会真正改变结果的偏好问得更具体。",
  };
}

function getCurrentFocusHint(profile: UserProfile, phase: "intake" | "followup") {
  if (phase === "intake") {
    if (!profile.score.trim() || !profile.rank.trim()) {
      return "先把分数和位次补准。";
    }
    if (profile.strategy_mode === "学校优先") {
      return "下一步重点看平台和城市。";
    }
    if (profile.strategy_mode === "专业优先") {
      return "下一步重点看专业方向。";
    }
    return "下一步继续缩窄偏好。";
  }

  if (profile.preferred_majors.length && !profile.preferred_cities.length) {
    return "下一步把城市落点缩出来。";
  }
  if (profile.preferred_cities.length && !profile.preferred_majors.length) {
    return "下一步把专业方向圈出来。";
  }
  return "下一步开始看推荐和排序。";
}

function buildIntakeSummaryItems(profile: UserProfile) {
  return [
    {
      label: "基本信息",
      value: `${profile.province} · ${profile.subject_track} · ${profile.score} 分 / 位次 ${profile.rank}`,
    },
    {
      label: "决策取向",
      value: `${profile.strategy_mode} · ${profile.career_goal}`,
    },
    {
      label: "风险设置",
      value: `${profile.risk_preference} · ${profile.accepts_adjustment ? "可接受调剂" : "尽量不接受调剂"}`,
    },
  ];
}

function getCoachIntro(stepKey: string, profile: UserProfile) {
  switch (stepKey) {
    case "province":
      return "志愿填报先别急着看学校名字，第一步先把省份钉死。不同省份，位次区间和玩法都不一样。";
    case "score_rank":
      return "分数可以参考，真正决定你能冲到哪一步的，很多时候是位次。先把底牌亮出来，后面才有资格谈选择。";
    case "subject_track":
      return "选科一旦没对上，后面很多专业连门都进不去，所以这一步不是小事。";
    case "strategy_mode":
      return "很多人不是不会选志愿，是压根没分清自己到底在保学校，还是在保专业。先把这个问题讲透。";
    case "career_goal":
      return "你以后更想要什么，决定了同样一所学校到底值不值得报。这个问题不能靠感觉糊弄过去。";
    case "accepts_adjustment":
      return "调剂这件事，嘴上说无所谓的人很多，真落到自己头上又接受不了，所以这一步要想明白。";
    case "risk_preference":
      return "冲稳保不是口号，是你能不能睡得着觉的区别。先把你的节奏定下来。";
    case "school_focus":
      return "既然你更在意学校，那就别笼统地说想要好学校，要先搞清楚你要的是哪一种平台。";
    case "city_focus":
      return "很多人嘴上说想去大城市，但最后真正能接受的城市层级并不一样，这一步得问细。";
    case "preferred_cities":
      return "城市别贪多，先圈出你真愿意去的范围。志愿填报不是旅游做攻略，太散最后反而不敢下手。";
    case "preferred_majors":
      return "专业方向先不用装得特别懂，但至少要知道自己更愿意往哪条路靠。";
    default:
      return "先把这一步讲清楚，后面的建议才不会越聊越乱。";
  }
}

function getCoachSelectionNote(stepKey: string, profile: UserProfile) {
  switch (stepKey) {
    case "province":
      return `你是${profile.province}考生，我后面会按${profile.province}的口径想，不会拿别省逻辑硬套你。`;
    case "score_rank":
      if (profile.score.trim() && profile.rank.trim()) {
        return `现在先记住：分数 ${profile.score} / 位次 ${profile.rank}。后面我会优先按位次判断，不跟你空谈学校名气。`;
      }
      return null;
    case "subject_track":
      return `你现在走的是“${profile.subject_track}”这条线，后面我会先过滤掉不适合这个赛道的选择。`;
    case "strategy_mode":
      return {
        均衡: "你现在还不想一刀切，这很正常。后面我会同时看学校和专业，不把你往极端路线里带。",
        学校优先: "你明显更在意平台，那后面我先帮你看学校层级和城市资源，不会先拿一堆细碎专业绕你。",
        专业优先: "你更在意方向，这反而更像真正会填志愿的人。后面我先帮你把专业路子看清楚。",
      }[profile.strategy_mode];
    case "career_goal":
      return {
        就业优先: "那我后面重点看城市资源、就业口径和行业去向，不会只给你好听的学校名头。",
        考研优先: "那我后面会更看升学氛围和继续深造空间，不会单纯拿就业热度吓你。",
        城市优先: "那我后面先把城市层级问清楚，再看学校和专业怎么取舍更现实。",
      }[profile.career_goal];
    case "accepts_adjustment":
      return profile.accepts_adjustment
        ? "你能接受调剂，后面方案空间会更大，但我会提醒你哪些调剂属于能接受、哪些属于踩坑。"
        : "你不想接受调剂，那后面我会把保底和专业可控性放得更重，不会让你为了冲学校把底线赌没了。";
    case "risk_preference":
      return {
        保守: "你更偏稳，那后面我会先保证落地，再考虑上限，不会给你一堆看着热闹的高风险建议。",
        均衡: "你走均衡路线，这最像大多数真实考生。后面我会同时给你留上限和留退路。",
        冲刺: "你愿意冲，那后面我会给你保留更多上限，但也会更直白地告诉你哪些冲法是在赌博。",
      }[profile.risk_preference];
    case "school_focus":
      return profile.school_focus
        ? `你现在更像“${profile.school_focus}”路线，我后面会优先按这类平台去筛学校，不会什么都往你面前堆。`
        : null;
    case "city_focus":
      return profile.city_focus
        ? `你现在更偏“${profile.city_focus}”，那后面我会先在这类城市里帮你看值不值得，再谈学校名气。`
        : null;
    case "preferred_cities":
      return profile.preferred_cities.length
        ? `你已经开始有城市倾向了：${profile.preferred_cities.join(" / ")}。这比一开始什么都想去，要强得多。`
        : null;
    case "preferred_majors":
      return profile.preferred_majors.length
        ? `你现在更愿意靠近这些方向：${profile.preferred_majors.join(" / ")}。后面我会优先围着它们判断。`
        : null;
    default:
      return null;
  }
}

function getIntakeValidationMessage(
  stepKey: (typeof INTAKE_STEPS)[number]["key"],
  profile: UserProfile,
) {
  if (stepKey === "score_rank") {
    if (!profile.score.trim() || !profile.rank.trim()) {
      return "这一问先把分数和位次补全，我们再往下走。";
    }

    if (Number.isNaN(Number(profile.score)) || Number.isNaN(Number(profile.rank))) {
      return "分数和位次需要是数字，这样系统才能先给你第一版判断。";
    }
  }

  return null;
}

function Card(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      <Text style={styles.cardSubtitle}>{props.subtitle}</Text>
      <View style={styles.cardBody}>{props.children}</View>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline ? styles.multilineInput : null]}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        keyboardType={props.keyboardType}
        multiline={props.multiline}
        textAlignVertical={props.multiline ? "top" : "center"}
        placeholderTextColor="#8D7265"
      />
    </View>
  );
}

function CoachDecisionPanel(props: {
  stepKey: string;
  profile: UserProfile;
  phase: "intake" | "followup";
}) {
  const feedback = getImmediateFeedback(props.stepKey, props.profile);
  const selectionNote = getCoachSelectionNote(props.stepKey, props.profile);
  const intro = getCoachIntro(props.stepKey, props.profile);
  const stageInsight = getStageInsight(props.profile, props.phase).body;
  const nextFocus = getCurrentFocusHint(props.profile, props.phase);
  const lines = uniqueLines(
    feedback?.body ?? stageInsight,
    selectionNote ?? stageInsight,
    feedback?.hint ?? nextFocus,
    !selectionNote ? intro : null,
  );

  return (
    <View style={styles.decisionCard}>
      <Text style={styles.decisionTitle}>顾问判断</Text>
      {lines[0] ? <Text style={styles.decisionBody}>{lines[0]}</Text> : null}
      {lines[1] ? <Text style={styles.decisionSupport}>{lines[1]}</Text> : null}
      {lines[2] ? <Text style={styles.decisionHint}>{lines[2]}</Text> : null}
    </View>
  );
}

function DecisionOptions(props: {
  label: string;
  options: Array<{ label: string; description: string }>;
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <View style={styles.choiceList}>
        {props.options.map((option) => {
          const active = props.selected === option.label;
          return (
            <Pressable
              key={`${props.label}-${option.label}`}
              style={[styles.choiceCard, active ? styles.choiceCardActive : null]}
              onPress={() => props.onSelect(option.label)}
            >
              <Text style={[styles.choiceTitle, active ? styles.choiceTitleActive : null]}>
                {option.label}
              </Text>
              <Text style={[styles.choiceBody, active ? styles.choiceBodyActive : null]}>
                {option.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ChipRow(props: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  single?: boolean;
}) {
  return (
    <View style={styles.chipGroup}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <View style={styles.chipWrap}>
        {props.options.map((option) => {
          const active = props.selected.includes(option);
          return (
            <Pressable
              key={`${props.label}-${option}`}
              style={[styles.chip, active ? styles.chipActive : null]}
              onPress={() => props.onToggle(option)}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F6EEE5",
  },
  flex: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 18,
    paddingBottom: 36,
    gap: 16,
  },
  hero: {
    marginTop: 14,
    padding: 20,
    borderRadius: 28,
    backgroundColor: "#5C2B15",
    gap: 10,
  },
  eyebrow: {
    color: "#EAB489",
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#FFF8F2",
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "800",
  },
  heroBody: {
    color: "#EEDBCE",
    fontSize: 15,
    lineHeight: 22,
  },
  heroMeta: {
    color: "#F5CAB0",
    fontSize: 13,
    lineHeight: 18,
  },
  statusPill: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#7C3A1E",
  },
  statusPillText: {
    color: "#FCE6D6",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  card: {
    backgroundColor: "#FFF8F2",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5D4C4",
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#3D1D10",
  },
  cardSubtitle: {
    marginTop: 4,
    color: "#8C6B58",
    fontSize: 13,
    lineHeight: 18,
  },
  cardBody: {
    marginTop: 16,
    gap: 14,
  },
  guideHeader: {
    gap: 4,
  },
  guideStepText: {
    color: "#8E4A1E",
    fontSize: 13,
    fontWeight: "800",
  },
  guideStepHint: {
    color: "#866655",
    fontSize: 13,
    lineHeight: 18,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#F0E1D3",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#C96B32",
  },
  questionCard: {
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#F7EEE5",
    borderWidth: 1,
    borderColor: "#E6D6C7",
  },
  questionTitle: {
    color: "#432113",
    fontSize: 21,
    lineHeight: 30,
    fontWeight: "800",
  },
  questionBody: {
    color: "#7A5B4A",
    lineHeight: 20,
  },
  confirmLead: {
    color: "#5B351F",
    lineHeight: 21,
    fontWeight: "700",
  },
  summaryRow: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E6D6C7",
  },
  summaryLabel: {
    color: "#96512B",
    fontSize: 12,
    fontWeight: "800",
  },
  summaryValue: {
    color: "#5C3521",
    lineHeight: 20,
  },
  decisionCard: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#F4E3D4",
    borderWidth: 1,
    borderColor: "#E4C8B3",
  },
  decisionTitle: {
    color: "#94481F",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  decisionBody: {
    color: "#5B351F",
    lineHeight: 21,
    fontWeight: "700",
  },
  decisionSupport: {
    color: "#72432B",
    lineHeight: 19,
  },
  decisionHint: {
    color: "#875331",
    lineHeight: 19,
  },
  judgementCard: {
    gap: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#EFD6C2",
    borderWidth: 1,
    borderColor: "#DFB89A",
  },
  judgementTitle: {
    color: "#7E3815",
    fontSize: 14,
    fontWeight: "800",
  },
  judgementLabel: {
    color: "#96512B",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  judgementBody: {
    color: "#5C3521",
    lineHeight: 20,
  },
  judgementHighlight: {
    color: "#5C3521",
    lineHeight: 20,
    fontWeight: "700",
  },
  flowActions: {
    flexDirection: "row",
    gap: 12,
  },
  ghostButton: {
    minHeight: 52,
    minWidth: 108,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#F5E8DB",
    borderWidth: 1,
    borderColor: "#E4D1C0",
  },
  ghostButtonDisabled: {
    backgroundColor: "#F4ECE4",
    borderColor: "#E9DDD1",
  },
  ghostButtonText: {
    color: "#70462F",
    fontSize: 15,
    fontWeight: "700",
  },
  ghostButtonTextDisabled: {
    color: "#B49D8F",
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  field: {
    flex: 1,
    gap: 8,
  },
  fieldLabel: {
    color: "#5A3420",
    fontSize: 14,
    fontWeight: "700",
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "#F5EBE1",
    borderWidth: 1,
    borderColor: "#E6D4C1",
    color: "#2F1C13",
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 96,
    paddingTop: 14,
  },
  chipGroup: {
    gap: 10,
  },
  choiceGroup: {
    gap: 10,
  },
  choiceList: {
    gap: 10,
  },
  choiceCard: {
    gap: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F6EBDD",
    borderWidth: 1,
    borderColor: "#E4D2C2",
  },
  choiceCardActive: {
    backgroundColor: "#F1D4BD",
    borderColor: "#C96B32",
  },
  choiceTitle: {
    color: "#4D2614",
    fontSize: 15,
    fontWeight: "800",
  },
  choiceTitleActive: {
    color: "#6A2E0F",
  },
  choiceBody: {
    color: "#7B5D4D",
    fontSize: 13,
    lineHeight: 18,
  },
  choiceBodyActive: {
    color: "#7A3D19",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#F3E7DA",
    borderWidth: 1,
    borderColor: "#E5D4C4",
  },
  chipActive: {
    backgroundColor: "#C96B32",
    borderColor: "#C96B32",
  },
  chipText: {
    color: "#5B341E",
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#FFF8F2",
  },
  quickAskChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "#F7EADC",
    borderWidth: 1,
    borderColor: "#E8D7C5",
  },
  quickAskChipActive: {
    backgroundColor: "#E3B189",
    borderColor: "#D68D55",
  },
  quickAskText: {
    color: "#6A412A",
    lineHeight: 18,
    fontSize: 13,
    fontWeight: "600",
  },
  quickAskTextActive: {
    color: "#4D240F",
  },
  binaryGroup: {
    gap: 10,
  },
  binaryOption: {
    gap: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F4E8DC",
    borderWidth: 1,
    borderColor: "#E3D2C2",
  },
  binaryOptionActive: {
    backgroundColor: "#F1D3BA",
    borderColor: "#C96B32",
  },
  binaryTitle: {
    color: "#4D2614",
    fontSize: 15,
    fontWeight: "800",
  },
  binaryTitleActive: {
    color: "#6B2E0E",
  },
  binaryBody: {
    color: "#7B5D4D",
    fontSize: 13,
    lineHeight: 18,
  },
  binaryBodyActive: {
    color: "#7A3C17",
  },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#C7541C",
  },
  flowPrimaryButton: {
    flex: 1,
  },
  primaryButtonText: {
    color: "#FFF8F2",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#F2D7BE",
  },
  secondaryButtonText: {
    color: "#5C2B15",
    fontSize: 16,
    fontWeight: "800",
  },
  placeholder: {
    color: "#826555",
    lineHeight: 22,
  },
  dataBanner: {
    gap: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F6E6D9",
    borderWidth: 1,
    borderColor: "#E4C7B1",
  },
  dataBannerReal: {
    backgroundColor: "#E6F2E8",
    borderColor: "#B6D0BA",
  },
  dataBannerTitle: {
    color: "#5C2B15",
    fontSize: 15,
    fontWeight: "800",
  },
  dataBannerBody: {
    color: "#7E5D4C",
    fontSize: 13,
    lineHeight: 18,
  },
  dataBannerNote: {
    color: "#A2481A",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  overviewCard: {
    gap: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F2DCC7",
    borderWidth: 1,
    borderColor: "#E5C3A9",
  },
  overviewTitle: {
    color: "#4C2211",
    fontSize: 15,
    fontWeight: "800",
  },
  overviewBody: {
    color: "#6A4836",
    lineHeight: 20,
  },
  overviewCounts: {
    color: "#8F4A20",
    fontSize: 13,
    fontWeight: "800",
  },
  overviewNext: {
    color: "#6E4731",
    lineHeight: 20,
  },
  planCard: {
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F4E4D4",
    borderWidth: 1,
    borderColor: "#DFC3AE",
  },
  planTitle: {
    color: "#4C2211",
    fontSize: 15,
    fontWeight: "800",
  },
  planBody: {
    color: "#6A4836",
    lineHeight: 20,
  },
  planToggleHint: {
    color: "#835F4B",
    fontSize: 13,
    lineHeight: 18,
  },
  planList: {
    gap: 10,
  },
  mergedCard: {
    borderRadius: 16,
    backgroundColor: "#FFF7F0",
    borderWidth: 1,
    borderColor: "#E6D0BE",
    overflow: "hidden",
  },
  mergedCardExpanded: {
    backgroundColor: "#FCF1E7",
  },
  mergedCardPressable: {
    padding: 12,
  },
  planItem: {
    flexDirection: "row",
    gap: 12,
  },
  planOrderBadge: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#B85A28",
  },
  planOrderText: {
    color: "#FFF8F2",
    fontSize: 14,
    fontWeight: "800",
  },
  planItemCopy: {
    flex: 1,
    gap: 4,
  },
  planItemTitle: {
    color: "#4A2313",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  planItemMeta: {
    color: "#8A6854",
    fontSize: 12,
    lineHeight: 17,
  },
  planItemReason: {
    color: "#654736",
    fontSize: 13,
    lineHeight: 19,
  },
  planExpandText: {
    color: "#9A5A31",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  mergedDetail: {
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: "#E8D8C9",
  },
  planReminder: {
    color: "#8F4A20",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  resultCard: {
    gap: 10,
    borderRadius: 20,
    backgroundColor: "#F7EEE5",
    padding: 14,
    borderWidth: 1,
    borderColor: "#E7D5C4",
  },
  resultCardSelected: {
    borderColor: "#C96B32",
    backgroundColor: "#F3DFC9",
  },
  resultHeader: {
    flexDirection: "row",
    gap: 12,
  },
  tierBadge: {
    width: 36,
    height: 36,
    textAlign: "center",
    textAlignVertical: "center",
    borderRadius: 18,
    overflow: "hidden",
    color: "#FFF8F2",
    backgroundColor: "#8E3F18",
    fontWeight: "800",
    fontSize: 16,
    lineHeight: 36,
  },
  resultHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  resultTitle: {
    color: "#3C1B0F",
    fontSize: 16,
    fontWeight: "800",
  },
  resultSubTitle: {
    color: "#866655",
    fontSize: 13,
    lineHeight: 18,
  },
  reasoningText: {
    color: "#5F4537",
    lineHeight: 20,
  },
  riskHint: {
    color: "#9A4E25",
    fontWeight: "700",
  },
  selectionHint: {
    color: "#7E5A43",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  compareToggleButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F3E7DA",
    borderWidth: 1,
    borderColor: "#DFCAB8",
  },
  compareToggleButtonActive: {
    backgroundColor: "#E8C9AF",
    borderColor: "#C96B32",
  },
  compareToggleText: {
    color: "#6A412A",
    fontSize: 12,
    fontWeight: "700",
  },
  compareToggleTextActive: {
    color: "#6B2E0E",
  },
  analysisCard: {
    gap: 10,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#F6E5D6",
    borderWidth: 1,
    borderColor: "#E5C8B2",
  },
  analysisTitle: {
    color: "#492113",
    fontSize: 16,
    fontWeight: "800",
  },
  analysisModeBanner: {
    gap: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#F3E1D2",
    borderWidth: 1,
    borderColor: "#E0C2AE",
  },
  analysisModeTitle: {
    color: "#4E2411",
    fontSize: 15,
    fontWeight: "800",
  },
  analysisModeBody: {
    color: "#765442",
    lineHeight: 20,
  },
  analysisTip: {
    color: "#7C5A49",
    lineHeight: 20,
  },
  analysisBody: {
    color: "#4D2A18",
    lineHeight: 23,
  },
  analysisNote: {
    color: "#906D59",
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: "#A02616",
    lineHeight: 20,
    paddingHorizontal: 4,
  },
});
