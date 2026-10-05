export type UserRole = 'ADMIN' | 'OFFICE_STAFF' | 'PRODUCTION_WORKER';
export type UserStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

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
  mobileNumber?: string | null;
  fullName: string;
  role: UserRole;
  status?: UserStatus;
  active: boolean;
  createdAt?: string;
  workerProfile?: WorkerProfile;
  skills?: WorkerSkill[];
  schedules?: WorkerSchedule[];
  available?: boolean;
  activeJobId?: string;
  activeJobTitle?: string;
  conflictOperationId?: string;
  invitation?: {
    id: string;
    channel?: string;
    expiresAt?: string | null;
    active?: boolean;
  };
}

export interface UserDevice {
  id: string;
  userId: string;
  deviceId: string;
  deviceLabel?: string | null;
  hasPin: boolean;
  pinSetAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string | null;
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

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  typicalLeadTimeDays?: number | null;
  notes?: string | null;
  active: boolean;
  isSeed?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AttendanceRecord {
  id: string;
  workerId: string;
  workerName: string | null;
  workDate: string;
  clockIn: string;
  clockOut: string | null;
  hoursWorked: number | null;
  note: string | null;
  recordedByName: string | null;
  updatedByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type AttendanceStatus =
  | 'PRESENT'
  | 'CLOCKED_IN'
  | 'INCOMPLETE'
  | 'ABSENT'
  | 'NOT_IN'
  | 'NOT_YET'
  | 'OFF';

export interface AttendanceRow {
  workerId: string;
  workerName: string;
  date: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isWorkingDay: boolean;
  status: AttendanceStatus;
  lateMinutes: number;
  record: AttendanceRecord | null;
}

export interface AttendanceDaySheet {
  date: string;
  rows: AttendanceRow[];
  counts: Partial<Record<AttendanceStatus, number>>;
  lateCount: number;
}

export interface AttendanceHistory {
  workerId: string;
  workerName: string;
  from: string;
  to: string;
  rows: AttendanceRow[];
  summary: {
    daysPresent: number;
    daysAbsent: number;
    daysLate: number;
    hoursPresent: number;
  };
}

export interface MaterialPurchase {
  id: string;
  jobOrderId: string;
  jobNumber?: string | null;
  jobTitle?: string | null;
  plannedMaterialId?: string | null;
  materialName: string;
  gradeOrSpec?: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  lineTotal?: number | null;
  supplierId: string;
  supplierName?: string | null;
  /** Null while the line sits on a draft supplier order. */
  dateOrdered: string | null;
  dateReceived?: string | null;
  consumedAt?: string | null;
  cancelledAt?: string | null;
  /** Null = recorded without a PO (before supplier orders). */
  supplierOrderId?: string | null;
  poNumber?: string | null;
  orderStatus?: SupplierOrderStatus | null;
  expectedDeliveryDate?: string | null;
  /** The PO's expected date as edited, or date ordered + lead time without a PO. */
  currentExpectedDate?: string | null;
  /** Days past the current expected date while not received; 0 otherwise. */
  daysOverdue?: number;
  status?: MaterialPurchaseStatus | string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SupplierReliability {
  supplierId: string;
  supplierName: string;
  active: boolean;
  dueDeliveries: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  overdueDeliveries: number;
  /** Null when fewer than 3 deliveries were due. */
  reliabilityPct: number | null;
  avgDaysLate: number;
  enoughData: boolean;
  label: string;
  rank: number | null;
}

export type MaterialPurchaseStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CONSUMED' | 'CANCELLED';

export type SupplierOrderStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface ExpectedDeliveryChange {
  from: string | null;
  to: string | null;
  note: string | null;
  changedByName: string | null;
  changedAt: string | null;
}

export interface MaterialRescheduleOutcome {
  jobId: string;
  jobNumber: string | null;
  outcome: 'MOVED' | 'NO_SLOT' | 'UNCHANGED';
  previousStart?: string;
  newStart?: string;
  materialDate?: string;
  message?: string | null;
}

export interface SupplierOrder {
  id: string;
  poNumber: string | null;
  supplierId: string;
  supplierName?: string | null;
  supplierLeadTimeDays?: number | null;
  status: SupplierOrderStatus;
  dateIssued?: string | null;
  expectedDeliveryDate?: string | null;
  originalExpectedDeliveryDate?: string | null;
  expectedDeliveryNote?: string | null;
  expectedDeliveryChanges?: ExpectedDeliveryChange[];
  movedJobs?: MaterialRescheduleOutcome[];
  notMovedJobs?: MaterialRescheduleOutcome[];
  receivedDate?: string | null;
  notes?: string | null;
  vatRate?: number | null;
  preparedById: string;
  preparedByName?: string | null;
  issuedById?: string | null;
  issuedByName?: string | null;
  lineCount: number;
  jobCount: number;
  subtotal: number;
  /** Days past the expected delivery date for lines not yet received. */
  daysOverdue?: number;
  createdAt?: string | null;
  lines?: MaterialPurchase[];
}

export interface OutstandingPlannedMaterial {
  jobOrderId: string;
  jobNumber: string;
  jobTitle: string;
  dueDate?: string | null;
  plannedMaterialId: string;
  materialName: string;
  unit: string;
  plannedQuantity: number | null;
  orderedQuantity: number;
  draftQuantity: number;
  remainingQuantity: number | null;
}

export interface OutstandingMaterials {
  materials: OutstandingPlannedMaterial[];
  jobs: { id: string; jobNumber: string; title: string }[];
}

export interface SupplierOrderLineInput {
  jobOrderId: string;
  plannedMaterialId?: string | null;
  materialName?: string;
  gradeOrSpec?: string | null;
  quantity: number;
  unit?: string;
  unitCost: number;
}

export interface SupplierOrderPrint {
  order: SupplierOrder;
  supplier: {
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  } | null;
  rows: {
    materialName: string;
    gradeOrSpec?: string | null;
    unit: string;
    unitCost: number;
    quantity: number;
    jobNumbers: string[];
    lineCount: number;
    amount: number;
  }[];
  subtotal: number;
  vatRate: number | null;
  vatAmount: number;
  total: number;
}

export interface MaterialStockBucket {
  count: number;
  value: number;
  quantityByUnit: { unit: string; quantity: number }[];
}

export interface MaterialPurchaseList {
  items: MaterialPurchase[];
  summary: {
    purchaseCount: number;
    totalSpend: number;
    awaitingDeliveryCount: number;
    /** Placed lines past their current expected date and not received. */
    overdueCount?: number;
    onOrder: MaterialStockBucket;
    onHand: MaterialStockBucket;
    consumed: MaterialStockBucket;
  };
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  jobOrderId: string;
  clientId: string;
  clientName?: string | null;
  description: string;
  subtotal: number;
  vatRate?: number | null;
  vatAmount: number;
  total: number;
  preparedById: string;
  preparedByName?: string | null;
  createdAt?: string | null;
}

export interface ClientDetail extends Client {
  jobs: {
    id: string;
    jobNumber?: string | null;
    title: string;
    createdAt?: string | null;
    dueDate?: string | null;
    amount?: number | null;
    status: JobOrderStatus;
    deliveredAt?: string | null;
    deliveredOnTime?: boolean | null;
  }[];
  totals: { jobCount: number; totalValue: number };
}

export type JobOrderStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DELIVERED';
export type JobPriority = 'HIGH' | 'MODERATE' | 'LOW';
export type JobType = 'FABRICATION' | 'MODIFICATION' | 'REPAIR';

export type MaterialStatus = 'NOT_REQUIRED' | 'TO_ORDER' | 'ORDERED' | 'RECEIVED';
export type PartCondition =
  | 'RAW_MATERIAL'
  | 'CLIENT_SUPPLIED_ITEM'
  | 'WORK_IN_PROCESS'
  | 'CUT'
  | 'BLANK'
  | 'FORMED'
  | 'MACHINED'
  | 'ASSEMBLED'
  | 'HEAT_TREATED'
  | 'FINISHED';
export type OperationStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'REWORK';

export type ReworkReasonCategory =
  | 'DIMENSION_OUT_OF_TOLERANCE'
  | 'SURFACE_FINISH'
  | 'WRONG_MATERIAL'
  | 'MACHINE_FAULT'
  | 'OPERATOR_ERROR'
  | 'OTHER';
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
  id?: string;
  name: string;
  quantity?: number;
  unit?: string;
  /** The shop already has it; it is not bought for this job. Set by the Admin. */
  fromStock?: boolean;
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

/** A released, unstarted job whose first operation the start gate would refuse. */
export interface MaterialWait {
  waitingForMaterials?: boolean;
  materialWaitCode?: 'MATERIALS_NOT_ORDERED' | 'MATERIALS_NOT_RECEIVED' | null;
  materialWaitReason?: string | null;
}

export type StaffAlertKind = 'MATERIAL_DELAY' | (string & {});

/** One entry in the header bell. */
export interface StaffAlert {
  id: string;
  kind: StaffAlertKind;
  title: string;
  message: string | null;
  jobOrderId: string | null;
  jobNumber: string | null;
  supplierOrderId: string | null;
  poNumber: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string | null;
}

/** MATERIAL: late or unordered materials set the new start. RESCHEDULED: only a passed start date. */
export type DelayKind = 'MATERIAL' | 'RESCHEDULED';

/** Set when the schedule was moved later automatically. */
export interface MaterialDelay {
  originalStart: string | null;
  currentStart: string | null;
  kind: DelayKind;
  reason: string | null;
  supplierOrderId: string | null;
  poNumber: string | null;
  delayedAt: string;
}

export interface Operation extends MaterialWait {
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
  reworkReasonCategory?: ReworkReasonCategory | null;
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
  defaultOperatorId?: string | null;
  defaultOperatorName?: string | null;
}

export interface MachineDowntimeRecord {
  id: string;
  machineUnitId: string;
  machineUnitLabel?: string | null;
  startedAt: string;
  endedAt?: string | null;
  category?: string | null;
  reason: string;
  jobOrderId?: string | null;
  operationId?: string | null;
  operationName?: string | null;
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
  assignedWorkerName?: string | null;
}

export interface MachineUnitStatus extends MachineUnitInfo {
  down: boolean;
  openDowntime?: MachineDowntimeRecord | null;
  affectedCount: number;
  currentOperation?: AffectedScheduledOperation | null;
  nextOperation?: AffectedScheduledOperation | null;
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
  materialNotBefore?: string | null;
  materialConstraintReason?: string | null;
  operations: ProposedOperation[];
  /** Everything that blocks confirming this proposal. */
  problems?: ScheduleProblem[];
  /** The saved schedule was shown as it was. */
  restored?: boolean;
  /** The saved schedule started at this time, already past, so a fresh one was proposed. */
  replacedPastStart?: string | null;
}

export interface ScheduleProblem {
  sequenceNo: number;
  operationId?: string | null;
  code: string;
  message: string;
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

export interface CompletionEstimateOperation {
  operationId: string;
  sequenceNo: number;
  operationName: string;
  operationTypeName: string | null;
  ratio: number;
  samples: number;
  enoughHistory: boolean;
  targetHours: number;
  hoursWorked: number;
  predictedHoursLeft: number;
  predictedStart: string;
  predictedEnd: string;
}

/** Finish estimate from past hours-worked-to-target ratios per operation type. */
export interface CompletionEstimate {
  label: string;
  predictedFinish: string;
  minSamples: number;
  operations: CompletionEstimateOperation[];
  notEnoughHistoryNote: string | null;
}

export interface JobOrder extends MaterialWait {
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
  partCondition?: PartCondition;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  amount?: number | null;
  rawMaterials?: RawMaterial[];
  materialStatus?: MaterialStatus;
  materialExpectedDate?: string | null;
  materialReceivedDate?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierReference?: string | null;
  materialReadiness?: MaterialReadiness;
  materialDelay?: MaterialDelay | null;
  plannedMaterials?: PlannedMaterialSummary[];
  createdById?: string;
  createdByName?: string | null;
  draftStage?: string | null;
  deliveredAt?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  opsCompleted?: number;
  opsTotal?: number;
  nextOperation?: string | null;
  nextOperationWorkerId?: string | null;
  nextOperationWorkerName?: string | null;
  operations?: Operation[];
  salesInvoice?: SalesInvoice | null;
  projectedCompletion?: string | null;
  /** Estimated finish from past performance (released jobs only). */
  predictedCompletion?: string | null;
  /** Uses the later of the scheduled and estimated finish. */
  scheduleFlag?: ScheduleFlag | null;
  scheduleFlagBasis?: 'SCHEDULE' | 'ESTIMATE' | null;
  /** Detail view only. */
  completionEstimate?: CompletionEstimate | null;
  scheduleColor?: string | null;
}

export interface PlannedMaterialSummary {
  id: string;
  name: string;
  unit?: string | null;
  plannedQuantity: number | null;
  /** On issued supplier orders or recorded without a PO. */
  purchasedQuantity: number;
  /** On a draft supplier order, not yet sent. */
  draftQuantity: number;
  remainingQuantity: number | null;
  fromStock: boolean;
  status: 'TO_ORDER' | 'PARTLY_ORDERED' | 'ON_DRAFT_ORDER' | 'PURCHASED' | 'FROM_STOCK';
}

export interface MaterialLineArrival {
  purchaseId: string;
  materialName: string;
  gradeOrSpec?: string | null;
  supplierName?: string | null;
  dateOrdered: string | null;
  leadTimeDays: number | null;
  dateReceived: string | null;
  poNumber?: string | null;
  expectedArrival: string | null;
  basis: 'RECEIVED' | 'LEAD_TIME' | 'UNKNOWN';
  /** Arrival taken from the supplier order's expected delivery date. */
  fromOrderDeliveryDate?: boolean;
  /** Days past the expected date; arrival is then tomorrow at the earliest. */
  daysOverdue?: number;
}

/** A supplier order holding this job's lines, or lines recorded without a PO. */
export interface JobSupplierOrderSummary {
  supplierOrderId: string | null;
  poNumber: string | null;
  supplierName: string | null;
  /** Null for lines recorded without a PO. */
  status: SupplierOrderStatus | null;
  expectedDeliveryDate: string | null;
  lineCount: number;
  daysOverdue?: number;
}

export interface MaterialReadiness {
  expectedDate: string | null;
  reason: string | null;
  source: 'PURCHASE_LINES' | 'JOB' | null;
  limitingLine: MaterialLineArrival | null;
  missingLeadTimeSuppliers: string[];
  lines: MaterialLineArrival[];
  supplierOrders: JobSupplierOrderSummary[];
  /** Planned materials not yet fully on a placed order. */
  unorderedMaterials: string[];
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
  workload: number;
  efficiency: number;
}

export interface ScoringWeights {
  skill: number;
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
  /** Set when the operation starts today and the worker is past their start time without a clock-in. */
  attendanceWarning?: string | null;
}

export type ToolCategory = 'RETURNABLE_TOOL' | 'CONSUMABLE';

export type ToolUnitStatus = 'AVAILABLE' | 'OUT' | 'UNDER_REPAIR' | 'RETIRED';

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

export interface ToolUnit {
  id: string;
  toolTypeId: string;
  toolTypeName: string | null;
  toolTypeCode: string | null;
  assetCode: string;
  status: ToolUnitStatus;
  notes: string | null;
  currentHolderId: string | null;
  currentHolderName: string | null;
  heldSince: string | null;
  createdAt?: string;
  isSeed?: boolean;
}

export interface ToolType {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isSeed: boolean;
  createdAt?: string;
  totalUnits: number;
  availableCount: number;
  outCount: number;
  repairCount: number;
  retiredCount: number;
  units?: ToolUnit[];
}

export type ToolEventType = 'BORROW' | 'RETURN' | 'ISSUE' | 'ADJUST' | 'RECEIVE';

export interface ToolEvent {
  id: string;
  toolId?: string | null;
  toolUnitId?: string | null;
  toolName?: string;
  toolCode?: string;
  assetCode?: string | null;
  toolCategory?: ToolCategory | 'TOOL_UNIT' | null;
  toolSizeSpec?: string | null;
  quantityOnHandAfter?: number | null;
  unitStatus?: ToolUnitStatus | null;
  currentHolderName?: string | null;
  workerId: string;
  workerName?: string;
  type: ToolEventType;
  quantity: number;
  reason?: string | null;
  supplier?: string | null;
  receivedOn?: string | null;
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
  consumptionSource?: 'STOCKTAKE' | 'BORROW' | string;
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
    assetCode?: string | null;
    category: ToolCategory | 'TOOL_UNIT' | null;
    sizeSpec: string | null;
    unit: string | null;
    eventCount: number;
    borrowQuantity: number | null;
    returnQuantity: number | null;
    netBorrowQuantity: number | null;
    /** @deprecated legacy field */
    issueQuantity?: number | null;
    netConsumptionQuantity?: number | null;
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
    borrowQuantity: number | null;
    consumptionQuantity: number | null;
    consumptionPerWorkingDay: number | null;
    issueQuantity?: number | null;
  }[];
}

export interface InventoryUsageConsumables {
  period: { from: string; to: string };
  workingDaysInPeriod: number;
  note: string;
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
    consumptionQuantity: number | null;
    consumptionPerWorkingDay: number | null;
    stocktakeWorkingDays: number;
  }[];
}

export interface StocktakeFormItem {
  toolId: string;
  name: string;
  code: string;
  unit: string;
  sizeSpec: string | null;
  quantityOnHand: number | null;
  minimumStock: number | null;
  lowStock: boolean;
  lastCountedOn: string | null;
  lastCountedQuantity: number | null;
}

export interface StocktakeForm {
  previousStocktakeOn: string | null;
  previousCountedByName: string | null;
  items: StocktakeFormItem[];
}

export interface StocktakeSummary {
  id: string;
  countedOn: string;
  countedById: string;
  countedByName: string | null;
  notes: string | null;
  createdAt: string;
  lineCount: number;
}

export interface StocktakeLine {
  id: string;
  stocktakeId: string;
  toolId: string;
  toolName: string | null;
  toolCode: string | null;
  unit: string | null;
  sizeSpec: string | null;
  previousQuantity: number | null;
  countedQuantity: number | null;
  delta: number | null;
}

export interface StocktakeDetail extends StocktakeSummary {
  lines: StocktakeLine[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  device?: { known: boolean; hasPin: boolean };
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
  jobs: {
    completed: number;
    onTime: number;
    late: number;
    awaitingDelivery: number;
    averageDaysLate: number | null;
    maxDaysLate: number | null;
  };
  efficiency: {
    averageVariancePct: number | null;
    completedOperationsWithVariance: number;
  };
  rework: {
    count: number;
    workedHours: number | null;
    shareOfTotalWorkedHoursPct: number | null;
    finishedOperationCount: number;
    finishedRedoOperationCount: number;
    redoRatePct: number | null;
  };
  downtime: { openCount: number };
  totals: {
    originalWorkedHours: number | null;
    reworkWorkedHours: number | null;
    totalWorkedHours: number | null;
  };
}

export interface AnalyticsJobOrders extends AnalyticsPeriodMeta {
  received: {
    count: number;
    amount: number | null;
    byJobType: { jobType: string; count: number; amount: number | null }[];
  };
  finished: AnalyticsOverview['jobs'];
  delivered: { count: number; onTime: number; late: number; amount: number | null };
  openNow: {
    byStatus: Record<'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED', number>;
    pastDateRequired: number;
  };
}

export interface MyWorkFigures {
  from: string;
  to: string;
  finishedOperations: number;
  redoOperations: number;
  hoursWorked: number | null;
  targetHours: number | null;
  laborEfficiencyPct: number | null;
}

export interface MyWorkSummary {
  thisWeek: MyWorkFigures;
  thisMonth: MyWorkFigures;
}

export interface AnalyticsWorkerRow {
  workerId: string;
  workerName: string;
  operationCount: number;
  totalEstimatedHours: number | null;
  totalActualWorkedHours: number | null;
  averageVariancePct: number | null;
  laborEfficiencyPct: number | null;
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
  laborEfficiencyPct: number | null;
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
  laborEfficiencyPct: number | null;
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
  laborEfficiencyPct: number | null;
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
  jobsFinished: number;
}

export interface AnalyticsTrend extends AnalyticsPeriodMeta {
  weeks: AnalyticsTrendWeek[];
}

export interface AnalyticsPauseReasonRow {
  reason: string;
  occurrenceCount: number;
  totalPausedHours: number | null;
}

export interface AnalyticsDelayCauseRow {
  cause: string;
  causeType: 'PAUSE' | 'DOWNTIME' | 'REWORK' | string;
  label: string;
  hours: number | null;
  occurrenceCount: number;
  shareOfTotalPct: number | null;
  cumulativePct: number | null;
}

export interface AnalyticsDowntimeRow {
  machineUnitId: string;
  machineUnitLabel: string | null;
  machineTypeCode: string | null;
  occurrenceCount: number;
  totalDowntimeHours: number | null;
  openCount: number;
}

export interface AnalyticsMaterialDelayRow {
  jobOrderId: string;
  jobNumber: string;
  cause: 'SUPPLIER_LATE' | 'NOT_ORDERED';
  causeLabel: string;
  originalStart: string;
  firstStart: string;
  started: boolean;
  /** First start, or now while the job has not started. */
  countedUntil: string;
  hours: number | null;
  moveCount: number;
  suppliers: { supplierId: string | null; supplierName: string; poNumber: string | null }[];
  supplierNames: string | null;
  reason: string | null;
}

export interface AnalyticsLateJobCause {
  cause: string;
  label: string;
  hours: number;
  detail: string | null;
}

export interface AnalyticsLateJobRow {
  jobOrderId: string;
  jobNumber: string;
  clientName: string | null;
  dueDate: string;
  deliveredDate: string;
  daysLate: number;
  causes: AnalyticsLateJobCause[];
}

export interface AnalyticsReworkReasonRow {
  reason: string;
  label: string;
  count: number;
  hours: number | null;
}

export interface AnalyticsDelays extends AnalyticsPeriodMeta {
  pauseReasons: AnalyticsPauseReasonRow[];
  machineDowntime: AnalyticsDowntimeRow[];
  causes: AnalyticsDelayCauseRow[];
  totalDelayHours: number | null;
  reworkByReason?: AnalyticsReworkReasonRow[];
  materialDelays?: AnalyticsMaterialDelayRow[];
  breakdownOverlapHours?: number | null;
  lateJobs?: AnalyticsLateJobRow[];
  excludedNonWorkingPauses?: {
    breakHours: number | null;
    endOfShiftHours: number | null;
    totalHours: number | null;
  };
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

export interface MovingAverageMonthRow {
  month: string;
  actual: number | null;
  forecast: number | null;
  absoluteError: number | null;
}

/** Monthly moving-average forecast with back-tested error. */
export interface MovingAverageForecast {
  method: string;
  window: number;
  monthsAvailable: number;
  monthsNeeded: number;
  enoughHistory: boolean;
  notEnoughHistoryNote: string | null;
  forecastMonth: string;
  forecast: number | null;
  mae: number | null;
  mapePct: number | null;
  backtestedMonths: number;
  months: MovingAverageMonthRow[];
}

export interface AnalyticsSalesMovingAverage extends MovingAverageForecast {
  label: string;
  description: string;
}

export interface AnalyticsSalesForecast {
  committedPipeline: AnalyticsCommittedPipeline;
  salesForecast: AnalyticsSalesMovingAverage;
}

export interface AnalyticsDemandJobTypeForecast extends MovingAverageForecast {
  jobType: JobType;
}

export interface AnalyticsDemandForecast extends MovingAverageForecast {
  label: string;
  description: string;
  byJobType: AnalyticsDemandJobTypeForecast[];
}

export interface ConsumableRunOutPeriod {
  from: string;
  to: string;
  workingDays: number;
  used: number | null;
}

export interface ConsumableRunOutRow {
  toolId: string;
  name: string;
  code: string;
  sizeSpec: string | null;
  unit: string;
  quantityOnHand: number | null;
  minimumStock: number | null;
  lowStock: boolean;
  lastCountedOn: string | null;
  periodsUsed: number;
  periods: ConsumableRunOutPeriod[];
  enoughData: boolean;
  notEnoughDataNote: string | null;
  dailyUsage: number | null;
  lastCountQuantity: number | null;
  deliveriesSinceCount: number | null;
  shopDaysSinceCount: number | null;
  estimatedOnHand: number | null;
  daysLeft: number | null;
  runOutDate: string | null;
  likelyOut: boolean;
}

export interface ConsumableRunOut {
  label: string;
  method: string;
  description: string;
  today: string;
  items: ConsumableRunOutRow[];
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

export interface AnalyticsPurchasingMaterialRow {
  materialName: string;
  purchaseCount: number;
  totalQuantity: number | null;
  totalSpend: number | null;
  unit: string | null;
}

export interface AnalyticsPurchasingSupplierSpendRow {
  supplierId: string;
  supplierName: string | null;
  purchaseCount: number;
  totalSpend: number | null;
}

export interface AnalyticsPurchasingLeadTimeRow {
  supplierId: string;
  supplierName: string | null;
  statedLeadTimeDays: number | null;
  sampleCount: number;
  averageActualDays: number | null;
  varianceDays: number | null;
}

export interface AnalyticsPurchasing {
  period: { from: string; to: string };
  purchaseCount: number;
  totalSpend: number | null;
  materialsByCount: AnalyticsPurchasingMaterialRow[];
  materialsBySpend: AnalyticsPurchasingMaterialRow[];
  spendBySupplier: AnalyticsPurchasingSupplierSpendRow[];
  supplierLeadTime: AnalyticsPurchasingLeadTimeRow[];
}

export interface WorkerWorkHistorySummary {
  operationsCompleted: number;
  reworkCount: number;
  enoughHistory: boolean;
  minimumForAverages: number;
  totalEstimatedHours: number | null;
  totalActualHours: number | null;
  averageVariancePct: number | null;
  onEstimateRatePct: number | null;
  message: string | null;
}

export interface WorkerHistoryOperation {
  id: string;
  completedAt: string | null;
  jobOrderId: string;
  jobNumber: string | null;
  operationName: string;
  operationTypeName?: string | null;
  machineUnitLabel: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  differenceHours: number | null;
  isRework: boolean;
}

export interface WorkerWorkHistory {
  summary: WorkerWorkHistorySummary;
  operations: {
    items: WorkerHistoryOperation[];
    total: number;
    page: number;
    pages: number;
    perPage: number;
  };
  toolsHeld: ToolUnit[];
  toolEvents: ToolEvent[];
}
