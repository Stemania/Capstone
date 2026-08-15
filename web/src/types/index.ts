export type UserRole = 'ADMIN' | 'OFFICE_STAFF' | 'PRODUCTION_WORKER';

export interface WorkerSkill {
  id?: string;
  workerId?: string;
  machineTypeId: string;
  machineTypeCode?: string | null;
  machineTypeName?: string | null;
  proficiency: number;
  isPrimary: boolean;
}

export interface WorkerSchedule {
  id?: string;
  workerId?: string;
  dayOfWeek: number;
  startTime?: string | null;
  endTime?: string | null;
  isWorking: boolean;
}

export interface OperationType {
  id: string;
  code: string;
  name: string;
  defaultMachineTypeId?: string | null;
  defaultMachineTypeCode?: string | null;
  defaultMachineTypeName?: string | null;
  active: boolean;
}

export interface WorkerProfile {
  id: string | null;
  userId: string;
  skills: WorkerSkill[] | string[];
  fullName?: string;
  email?: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  createdAt?: string;
  workerProfile?: WorkerProfile;
  skills?: WorkerSkill[];
  schedules?: WorkerSchedule[];
  available?: boolean;
  activeJobId?: string;
  activeJobTitle?: string;
  conflictOperationId?: string;
}

export interface Client {
  id: string;
  name: string;
  contact?: string;
  email?: string | null;
  mobileNumber?: string | null;
  notifyByEmail?: boolean;
  notifyBySms?: boolean;
  createdAt?: string;
}

export type JobOrderStatus =
  | 'DRAFT'
  | 'PLANNING'
  | 'RELEASED'
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DELIVERED';
export type JobPriority = 'HIGH' | 'MODERATE' | 'LOW';
export type JobType = 'FABRICATION' | 'MODIFICATION' | 'REPAIR';
export type MaterialSource = 'SHOP_PROCURED' | 'CLIENT_SUPPLIED';
export type PartCondition =
  | 'RAW_MATERIAL'
  | 'CLIENT_SUPPLIED_ITEM'
  | 'BLANK'
  | 'WORK_IN_PROCESS'
  | 'MACHINED'
  | 'HEAT_TREATED'
  | 'FINISHED';
export type OperationStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'REWORK';
export type MachineCode = 'LATHE' | 'MILLING' | 'SHAPER' | 'GRINDING' | 'DRILLING';

export interface MachineInfo {
  id?: string | null;
  code: MachineCode | string;
  name: string;
  units: number;
  inUse?: number;
  available?: number;
}

export interface RawMaterial {
  name: string;
  quantity?: number;
  unit?: string;
}

export type OperationTimeEvent = 'START' | 'PAUSE' | 'RESUME' | 'COMPLETE';

export type OperationPauseReason =
  | 'END_OF_SHIFT'
  | 'BREAK'
  | 'MACHINE_DOWN'
  | 'WAITING_MATERIAL'
  | 'WAITING_PRIOR_OPERATION'
  | 'OTHER';

export interface OperationTimeLog {
  id: string;
  operationId: string;
  workerId: string;
  workerName?: string | null;
  event: OperationTimeEvent;
  eventAt: string;
  reason?: OperationPauseReason | null;
  note?: string | null;
}

export type ScheduleFlag = 'GREEN' | 'AMBER' | 'RED';

export interface ScheduleSegment {
  start: string;
  end: string;
}

export interface Operation {
  id: string;
  jobOrderId: string;
  jobTitle?: string;
  jobNumber?: string;
  clientName?: string;
  dueDate?: string;
  jobPriority?: JobPriority;
  sequenceNo: number;
  operationName: string;
  operationTypeId?: string | null;
  operationTypeCode?: string | null;
  machineTypeId?: string | null;
  machineTypeCode?: string | null;
  machineTypeName?: string | null;
  machineUnitId?: string | null;
  machineUnitLabel?: string | null;
  assignedWorkerId?: string | null;
  assignedWorkerName?: string | null;
  estimatedHours?: number | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  segments?: ScheduleSegment[];
  actualStart?: string | null;
  actualEnd?: string | null;
  actualWorkedHours?: number | null;
  varianceHours?: number | null;
  variancePct?: number | null;
  startedAt?: string;
  completedAt?: string;
  status: OperationStatus;
  reworkOfOperationId?: string | null;
  reworkReason?: string | null;
  notes?: string | null;
  timeLogs?: OperationTimeLog[];
  isPaused?: boolean;
  machineDown?: boolean;
  /** Legacy aliases */
  seq?: number;
  name?: string;
  machinesNeeded?: string[];
  machineNames?: string[];
}

export interface MachineUnitInfo {
  id: string;
  machineTypeId: string;
  machineTypeCode?: string | null;
  machineTypeName?: string | null;
  label: string;
  active?: boolean;
}

export interface MachineDowntimeRecord {
  id: string;
  machineUnitId: string;
  machineUnitLabel?: string | null;
  startedAt: string;
  endedAt?: string | null;
  reason: string;
  reportedById: string;
  reportedByName?: string | null;
  note?: string | null;
  open: boolean;
  createdAt?: string | null;
  affectedCount?: number;
  affectedOperations?: AffectedScheduledOperation[];
}

export interface AffectedScheduledOperation {
  id: string;
  jobOrderId: string;
  jobNumber?: string | null;
  jobTitle?: string | null;
  operationName: string;
  status?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export interface MachineUnitStatus extends MachineUnitInfo {
  down: boolean;
  openDowntime?: MachineDowntimeRecord | null;
  affectedCount: number;
}

export interface ProposedOperation {
  id?: string | null;
  sequenceNo: number;
  operationName?: string;
  assignedWorkerId?: string | null;
  machineTypeId?: string | null;
  machineUnitId?: string | null;
  machineUnitLabel?: string | null;
  estimatedHours?: number;
  estimatedHoursDefaulted?: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  segments?: ScheduleSegment[];
  scheduled: boolean;
  message?: string | null;
  placeableHours?: number | null;
  requiredHours?: number | null;
}

export interface ScheduleProposeResult {
  proposed: boolean;
  anchor?: string;
  horizonDays?: number;
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
  operations: ProposedOperation[];
}

export interface ScheduleWarning {
  sequenceNo: number;
  code: string;
  message: string;
}

export interface ScheduleValidateResult {
  warnings: ScheduleWarning[];
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
}

export interface JobOrder {
  id: string;
  jobNumber?: string;
  clientId: string;
  clientName?: string;
  title: string;
  description?: string;
  dueDate: string;
  clientPoNumber?: string | null;
  poDate?: string | null;
  status: JobOrderStatus;
  priority?: JobPriority;
  jobType?: JobType;
  materialSource?: MaterialSource;
  partCondition?: PartCondition;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  amount?: number | null;
  rawMaterials?: RawMaterial[];
  createdById?: string;
  deliveredAt?: string | null;
  createdAt?: string;
  opsCompleted?: number;
  opsTotal?: number;
  nextOperation?: string | null;
  nextOperationWorkerId?: string | null;
  nextOperationWorkerName?: string | null;
  operations?: Operation[];
  projectedCompletion?: string | null;
  scheduleFlag?: ScheduleFlag | null;
}

export type NotificationMilestone =
  | 'JOB_RECEIVED'
  | 'JOB_STARTED'
  | 'JOB_COMPLETED'
  | 'JOB_DELIVERED';

export type NotificationChannel = 'EMAIL' | 'SMS';

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface NotificationLog {
  id: string;
  jobOrderId: string;
  jobNumber?: string | null;
  jobTitle?: string | null;
  clientId: string;
  clientName?: string | null;
  milestone: NotificationMilestone;
  channel: NotificationChannel;
  recipient: string;
  messageBody: string;
  status: NotificationStatus;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
}

export interface ScoringComponents {
  skill: number;
  availability: number;
  workload: number;
  efficiency: number;
}

export interface ScoringWeights {
  skill: number;
  availability: number;
  workload: number;
  efficiency: number;
}

export interface WorkerSuggestion {
  workerId: string;
  fullName: string;
  email: string;
  skills: string[];
  score: number;
  matchedSkills: string[];
  available?: boolean;
  proficiency?: number | null;
  qualified?: boolean;
  components?: ScoringComponents;
  reason?: string;
}

export type ToolCategory = 'RETURNABLE_TOOL' | 'CONSUMABLE';

export interface ToolHolder {
  holderId: string;
  holderName: string | null;
  quantity: number;
  since: string | null;
}

export interface Tool {
  id: string;
  name: string;
  code: string;
  category: ToolCategory;
  unit: string;
  quantityOnHand: number;
  minimumStock: number | null;
  sizeSpec: string | null;
  lowStock: boolean;
  createdAt?: string;
  myOutstanding?: number | null;
  holders?: ToolHolder[];
  custody?: {
    holderId: string;
    holderName: string | null;
    since: string | null;
    quantity?: number;
  } | null;
}

export type ToolEventType = 'BORROW' | 'RETURN' | 'ISSUE' | 'ADJUST';

export interface ToolEvent {
  id: string;
  toolId: string;
  toolName?: string;
  toolCode?: string;
  toolCategory?: ToolCategory | null;
  toolSizeSpec?: string | null;
  quantityOnHandAfter?: number | null;
  workerId: string;
  workerName?: string;
  type: ToolEventType;
  quantity: number;
  reason?: string | null;
  jobOrderId?: string;
  createdAt: string;
}

export interface InventoryPurchaseSuggestion {
  toolId: string;
  name: string;
  code: string;
  category: ToolCategory;
  sizeSpec: string | null;
  unit: string;
  quantityOnHand: number | null;
  minimumStock: number | null;
  suggestedOrderQuantity: number | null;
  recentConsumptionQuantity: number | null;
  consumptionPerWorkingDay: number | null;
  lookbackWorkingDays: number;
}

export interface InventoryPurchaseSuggestions {
  label: string;
  description: string;
  period: { from: string; to: string };
  workingDaysInSample: number;
  itemCount: number;
  items: InventoryPurchaseSuggestion[];
}

export interface InventoryUsageByWorker {
  period: { from: string; to: string };
  workingDaysInPeriod: number;
  byWorkerItem: {
    workerId: string;
    workerName: string | null;
    toolId: string;
    toolName: string | null;
    toolCode: string | null;
    category: ToolCategory | null;
    sizeSpec: string | null;
    unit: string | null;
    eventCount: number;
    issueQuantity: number | null;
    borrowQuantity: number | null;
    returnQuantity: number | null;
    netConsumptionQuantity: number | null;
  }[];
  outstandingUnreturned: {
    workerId: string;
    workerName: string | null;
    totalOutstandingQuantity: number | null;
    items: {
      toolId: string;
      toolName: string;
      toolCode: string;
      quantity: number | null;
    }[];
  }[];
}

export interface InventoryUsageByItem {
  period: { from: string; to: string };
  workingDaysInPeriod: number;
  items: {
    toolId: string;
    name: string;
    code: string;
    category: ToolCategory;
    sizeSpec: string | null;
    unit: string;
    quantityOnHand: number | null;
    minimumStock: number | null;
    lowStock: boolean;
    issueQuantity: number | null;
    borrowQuantity: number | null;
    consumptionQuantity: number | null;
    consumptionPerWorkingDay: number | null;
  }[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export const MACHINE_OPTIONS: MachineInfo[] = [
  { code: 'LATHE', name: 'Lathe', units: 7 },
  { code: 'MILLING', name: 'Milling', units: 8 },
  { code: 'SHAPER', name: 'Shaper', units: 1 },
  { code: 'GRINDING', name: 'Grinding', units: 2 },
  { code: 'DRILLING', name: 'Drilling', units: 1 },
];

/** Analytics API (Admin / Office) */
export interface AnalyticsPeriodMeta {
  period: { from: string; to: string };
  excludedOperationCount: number;
}

export interface AnalyticsOverview extends AnalyticsPeriodMeta {
  jobs: { completed: number; onTime: number; late: number };
  efficiency: {
    averageVariancePct: number | null;
    completedOperationsWithVariance: number;
  };
  rework: {
    count: number;
    workedHours: number | null;
    shareOfTotalWorkedHoursPct: number | null;
  };
  downtime: { openCount: number };
  totals: {
    originalWorkedHours: number | null;
    reworkWorkedHours: number | null;
    totalWorkedHours: number | null;
  };
}

export interface AnalyticsWorkerRow {
  workerId: string;
  workerName: string;
  operationCount: number;
  totalEstimatedHours: number | null;
  totalActualWorkedHours: number | null;
  averageVariancePct: number | null;
  onEstimateRatePct: number | null;
  reworkWorkedHours: number | null;
}

export interface AnalyticsByWorker extends AnalyticsPeriodMeta {
  minimumOperationCount: number;
  workers: AnalyticsWorkerRow[];
}

export interface AnalyticsOperationTypeRow {
  operationTypeId: string;
  operationTypeCode: string;
  operationTypeName: string;
  operationCount: number;
  totalEstimatedHours: number | null;
  totalActualWorkedHours: number | null;
  averageVariancePct: number | null;
  onEstimateRatePct: number | null;
  reworkWorkedHours: number | null;
}

export interface AnalyticsByOperationType extends AnalyticsPeriodMeta {
  minimumOperationCount: number;
  operationTypes: AnalyticsOperationTypeRow[];
}

export interface AnalyticsMachineUnitRow {
  machineUnitId: string;
  machineUnitLabel: string;
  machineTypeId: string;
  machineTypeCode: string | null;
  operationCount: number;
  totalEstimatedHours: number | null;
  totalActualWorkedHours: number | null;
  averageVariancePct: number | null;
  onEstimateRatePct: number | null;
  belowMinimumSample: boolean;
  reworkWorkedHours: number | null;
  busySegmentHours: number | null;
  availableHours: number | null;
  utilizationPct: number | null;
}

export interface AnalyticsMachineTypeRow {
  machineTypeId: string;
  machineTypeCode: string;
  machineTypeName: string;
  activeUnitCount: number;
  operationCount: number;
  totalEstimatedHours: number | null;
  totalActualWorkedHours: number | null;
  averageVariancePct: number | null;
  onEstimateRatePct: number | null;
  belowMinimumSample: boolean;
  reworkWorkedHours: number | null;
  busySegmentHours: number | null;
  availableHours: number | null;
  utilizationPct: number | null;
}

export interface AnalyticsByMachine extends AnalyticsPeriodMeta {
  minimumOperationCount: number;
  availableHoursPerUnit: number | null;
  machineTypes: AnalyticsMachineTypeRow[];
  machineUnits: AnalyticsMachineUnitRow[];
}

export interface AnalyticsTrendWeek {
  weekStart: string;
  operationCount: number;
  averageVariancePct: number | null;
}

export interface AnalyticsTrend extends AnalyticsPeriodMeta {
  weeks: AnalyticsTrendWeek[];
}

export interface AnalyticsPauseReasonRow {
  reason: string;
  occurrenceCount: number;
  totalPausedHours: number | null;
}

export interface AnalyticsDowntimeRow {
  machineUnitId: string;
  machineUnitLabel: string | null;
  machineTypeCode: string | null;
  occurrenceCount: number;
  totalDowntimeHours: number | null;
  openCount: number;
}

export interface AnalyticsDelays extends AnalyticsPeriodMeta {
  pauseReasons: AnalyticsPauseReasonRow[];
  machineDowntime: AnalyticsDowntimeRow[];
}

export interface AnalyticsSalesMonthRow {
  month: string;
  jobCount: number;
  amount: number | null;
  partialPeriod: boolean;
  workingDaysCovered: number;
}

export interface AnalyticsSalesClientRow {
  clientId: string;
  clientName: string | null;
  jobCount: number;
  amount: number | null;
  averageJobValue: number | null;
}

export interface AnalyticsSalesJobTypeRow {
  jobType: string;
  jobCount: number;
  amount: number | null;
}

export interface AnalyticsSalesSummary {
  period: { from: string; to: string };
  workingDaysInPeriod: number;
  completedJobCount: number;
  totalAmount: number | null;
  byMonth: AnalyticsSalesMonthRow[];
  byClient: AnalyticsSalesClientRow[];
  byJobType: AnalyticsSalesJobTypeRow[];
}

export interface AnalyticsPipelineMonthRow {
  month: string;
  jobCount: number;
  amount: number | null;
}

export interface AnalyticsCommittedPipeline {
  label: string;
  description: string;
  totalAmount: number | null;
  jobCount: number;
  byExpectedCompletionMonth: AnalyticsPipelineMonthRow[];
}

export interface AnalyticsProjectedRevenue {
  label: string;
  description: string;
  sampleCompletedJobs: number;
  sampleWorkingDays: number;
  sampleWeeks: number;
  revenuePerWorkingDay: number | null;
  horizonWeeks: number;
  horizon: { from: string; to: string };
  horizonWorkingDays: number;
  projectedAmount: number | null;
  thinSampleNote?: string;
}

export interface AnalyticsSalesForecast {
  period: { from: string; to: string };
  workingDaysInSample: number;
  sampleWeeks: number;
  thinSample: boolean;
  committedPipeline: AnalyticsCommittedPipeline;
  projectedRevenue: AnalyticsProjectedRevenue;
}

export interface AnalyticsCapacityTypeRow {
  machineTypeId: string;
  machineTypeCode: string;
  machineTypeName: string | null;
  activeUnitCount: number;
  availableHours: number | null;
  scheduledLoadHours: number | null;
  projectedLoadPct: number | null;
  above80Pct: boolean;
}

export interface AnalyticsDemandCapacity {
  horizon: { from: string; to: string };
  horizonWorkingDays: number;
  availableHoursPerUnit: number | null;
  scheduledOperationsInHorizon: number;
  thinSample: boolean;
  thinSampleNote?: string;
  machineTypes: AnalyticsCapacityTypeRow[];
}
