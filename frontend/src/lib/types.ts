export type Role = 'STUDENT' | 'FACULTY' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type ExamStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | 'CANCELLED' | 'ARCHIVED';
export type ExamPhase = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED' | 'ARCHIVED';
export type ExamAction = 'SUBMIT' | 'WITHDRAW' | 'APPROVE' | 'REJECT' | 'PUBLISH' | 'UNPUBLISH' | 'CANCEL' | 'ARCHIVE' | 'RESTORE';
export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';
export type AnnouncementAudience = 'ALL' | 'STUDENT' | 'FACULTY';

/** Permission names returned by the server in `user.permissions` (UI hints only; the server enforces them). */
export type Permission =
  | 'admin:access' | 'user:read' | 'user:manage' | 'user:delete' | 'role:assign' | 'settings:read' | 'settings:manage'
  | 'audit:read' | 'report:view' | 'report:export' | 'announcement:send_all' | 'announcement:send_students'
  | 'exam:create' | 'exam:manage_own' | 'exam:manage_any' | 'exam:submit' | 'exam:approve' | 'exam:publish' | 'exam:cancel'
  | 'exam:archive' | 'attempt:grade' | 'result:read_own_exams' | 'result:read_all' | 'result:publish' | 'result:correct'
  | 'exam:take' | 'result:read_self';
export type ResultRelease = 'IMMEDIATE' | 'AFTER_END' | 'MANUAL';
export type QuestionType = 'MCQ' | 'MULTI_SELECT' | 'TRUE_FALSE' | 'DESCRIPTIVE';
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED';
export type SubmissionType = 'MANUAL' | 'AUTO_TIMEOUT';
export type ResultStatus = 'PENDING_REVIEW' | 'GRADED';
export type NotificationType = 'INFO' | 'EXAM' | 'RESULT' | 'ANNOUNCEMENT' | 'ACCOUNT';

export interface StudentProfile {
  rollNumber: string | null;
  department: string | null;
  year: number | null;
  phone: string | null;
}
export interface FacultyProfile {
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  phone: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  deletedAt?: string | null;
  studentProfile: StudentProfile | null;
  facultyProfile: FacultyProfile | null;
}

/** The signed-in user as returned by /auth/me, /auth/login and /auth/register. */
export interface SessionUser extends User {
  permissions: Permission[];
  policy: { requireExamApproval: boolean; facultyCanPublishResults: boolean };
}

export interface PublicSettings {
  institutionName: string;
  allowStudentRegistration: boolean;
  supportEmail: string;
}

export interface SystemSettings extends PublicSettings {
  requireExamApproval: boolean;
  facultyCanPublishResults: boolean;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// ---------- Student ----------
export interface StudentExamCard {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  durationMinutes: number;
  totalMarks: number;
  passMarks: number;
  maxAttempts: number;
  startsAt: string;
  endsAt: string;
  status: ExamStatus;
  negativeMarking: boolean;
  resultRelease: ResultRelease;
  resultsPublishedAt: string | null;
  createdBy: { name: string };
  questionCount: number;
  phase: ExamPhase;
  attemptsUsed: number;
  inProgressAttemptId: string | null;
  canStart: boolean;
}

export interface StudentExamDetail extends StudentExamCard {
  instructions: string | null;
  negativeMarkRatio: number;
  attempts: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    startedAt: string;
    submittedAt: string | null;
    submissionType: SubmissionType | null;
  }[];
}

export interface StudentDashboard {
  stats: { totalExams: number; upcomingExams: number; completedExams: number; averageScore: number | null; passedCount: number };
  liveExams: StudentExamCard[];
  upcomingExams: StudentExamCard[];
  performance: { attemptId: string; exam: string; subject: string; percentage: number; date: string }[];
  subjectPerformance: { subject: string; average: number; exams: number }[];
  recentResults: {
    attemptId: string;
    examTitle: string;
    subject: string;
    submittedAt: string;
    released: boolean;
    status: ResultStatus;
    percentage: number | null;
    passed: boolean | null;
  }[];
  notifications: Notification[];
}

export interface AttemptQuestion {
  id: string;
  type: QuestionType;
  text: string;
  marks: number;
  order: number;
  options: { id: string; text: string }[];
}

export interface SavedAnswer {
  questionId: string;
  selectedOptionIds: string[];
  textAnswer: string | null;
  markedForReview: boolean;
}

export interface AttemptState {
  attempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    startedAt: string;
    deadlineAt: string;
    submittedAt: string | null;
    submissionType: SubmissionType | null;
  };
  exam: {
    id: string;
    title: string;
    subject: string;
    instructions: string | null;
    durationMinutes: number;
    totalMarks: number;
    passMarks: number;
    negativeMarking: boolean;
    negativeMarkRatio: number;
  };
  serverNow: string;
  questions: AttemptQuestion[];
  answers: SavedAnswer[];
}

export interface SubmitReceipt {
  receipt: {
    attemptId: string;
    examId: string;
    examTitle: string;
    attemptNumber: number;
    submittedAt: string;
    submissionType: SubmissionType;
    status: AttemptStatus;
  };
  alreadySubmitted: boolean;
}

export interface StudentResultRow {
  attemptId: string;
  attemptNumber: number;
  submittedAt: string;
  submissionType: SubmissionType;
  exam: { id: string; title: string; subject: string; totalMarks: number };
  resultStatus: ResultStatus;
  examCancelled: boolean;
  released: boolean;
  score: number | null;
  maxScore: number;
  percentage: number | null;
  passed: boolean | null;
}

export interface StudentResultDetail {
  attempt: { id: string; attemptNumber: number; startedAt: string; submittedAt: string; submissionType: SubmissionType };
  student: { name: string; email: string; studentProfile: { rollNumber: string | null; department: string | null } | null };
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    totalMarks: number;
    passMarks: number;
    negativeMarking: boolean;
    negativeMarkRatio: number;
    faculty: string;
    resultRelease: ResultRelease;
  };
  released: boolean;
  examCancelled: boolean;
  answersRevealed: boolean;
  resultStatus: ResultStatus;
  result: {
    totalScore: number;
    maxScore: number;
    percentage: number;
    passed: boolean;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    objectiveScore: number;
    descriptiveScore: number;
    gradedAt: string | null;
  } | null;
  questions: {
    id: string;
    order: number;
    type: QuestionType;
    text: string;
    marks: number;
    explanation: string | null;
    options: { id: string; text: string; isCorrect?: boolean }[];
    response: {
      selectedOptionIds: string[];
      textAnswer: string | null;
      marksAwarded: number | null;
      isCorrect: boolean | null;
      feedback: string | null;
    };
  }[];
}

// ---------- Faculty ----------
export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
  order: number;
}

export interface Question {
  id: string;
  examId: string;
  type: QuestionType;
  text: string;
  marks: number;
  order: number;
  explanation: string | null;
  options: QuestionOption[];
}

export interface ExamSummary {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  instructions: string | null;
  durationMinutes: number;
  totalMarks: number;
  passMarks: number;
  negativeMarking: boolean;
  negativeMarkRatio: number;
  maxAttempts: number;
  startsAt: string;
  endsAt: string;
  status: ExamStatus;
  resultRelease: ResultRelease;
  resultsPublishedAt: string | null;
  publishedAt: string | null;
  submittedForApprovalAt: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  /** Reviewer note: approval comment, rejection reason or cancellation reason. */
  reviewNote: string | null;
  cancelledAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string };
  phase: ExamPhase;
  questionCount: number;
  attemptCount: number;
  /** Present on /exams list rows: workflow actions the current user may take (server re-validates). */
  allowedActions?: ExamAction[];
}

export interface ExamStatusChange {
  id: string;
  fromStatus: ExamStatus;
  toStatus: ExamStatus;
  action: ExamAction;
  reason: string | null;
  createdAt: string;
  actor: { name: string; role: Role } | null;
}

export interface ExamDetail extends Omit<ExamSummary, 'questionCount'> {
  questions: Question[];
  /** True unless editLevel is FULL. */
  locked: boolean;
  editLevel: 'FULL' | 'SAFE' | 'NONE';
  /** Exam settings fields the server will accept right now. */
  editableFields: string[];
  /** Workflow actions the current user may take now (server re-validates). */
  allowedActions: ExamAction[];
  requiresApproval: boolean;
  approvedBy: { id: string; name: string } | null;
  statusChanges: ExamStatusChange[];
}

export interface ExamInput {
  title: string;
  description?: string | null;
  subject: string;
  instructions?: string | null;
  durationMinutes: number;
  passMarks: number;
  negativeMarking: boolean;
  negativeMarkRatio: number;
  maxAttempts: number;
  startsAt: string;
  endsAt: string;
  resultRelease: ResultRelease;
}

export interface QuestionInput {
  type: QuestionType;
  text: string;
  marks: number;
  explanation?: string | null;
  options: { text: string; isCorrect: boolean }[];
}

export interface ResultRecord {
  id: string;
  attemptId: string;
  examId: string;
  studentId: string;
  objectiveScore: number;
  descriptiveScore: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  pendingReviewCount: number;
  status: ResultStatus;
  gradedAt: string | null;
  publishedAt: string | null;
  publishedById: string | null;
  createdAt: string;
}

export interface ResultRevision {
  id: string;
  questionId: string | null;
  kind: 'GRADE' | 'CORRECTION';
  reason: string | null;
  previousMarks: number | null;
  newMarks: number | null;
  previousTotalScore: number;
  newTotalScore: number;
  createdAt: string;
  actor: { name: string; role: Role } | null;
}

export interface ExamAttemptRow {
  id: string;
  examId: string;
  studentId: string;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  submissionType: SubmissionType | null;
  result: ResultRecord | null;
  released: boolean;
  student: { id: string; name: string; email: string; studentProfile: { rollNumber: string | null; department: string | null } | null };
}

export interface ExamStats {
  totalMarks: number;
  submissions: number;
  participants: number;
  inProgress: number;
  pendingReview: number;
  released: number;
  awaitingPublication: number;
  averagePercentage: number;
  highestScore: number;
  lowestScore: number;
  passRate: number;
  distribution: { range: string; count: number }[];
  questionStats: { questionId: string; order: number; text: string; type: QuestionType; answered: number; correctRate: number | null }[];
}

export interface AttemptReview {
  id: string;
  examId: string;
  studentId: string;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  submissionType: SubmissionType | null;
  result: (ResultRecord & { publishedBy: { name: string } | null; revisions: ResultRevision[] }) | null;
  /** Whether the student can already see this result (changes then count as corrections). */
  released: boolean;
  student: ExamAttemptRow['student'];
  exam: {
    id: string; title: string; subject: string; status: ExamStatus; totalMarks: number; passMarks: number;
    negativeMarking: boolean; negativeMarkRatio: number; resultRelease: ResultRelease;
  };
  questions: (Question & { answer: ReviewAnswer | null })[];
}

export interface ReviewAnswer {
  id: string;
  selectedOptionIds: string[];
  textAnswer: string | null;
  markedForReview: boolean;
  marksAwarded: number | null;
  overrideMarks: number | null;
  isCorrect: boolean | null;
  feedback: string | null;
  gradedAt: string | null;
  gradedBy: { name: string } | null;
}

export interface FacultyDashboard {
  stats: {
    totalExams: number; drafts: number; pendingApproval: number; rejected: number; liveCount: number;
    scheduledCount: number; submissions: number; pendingReview: number;
  };
  liveExams: (Omit<ExamSummary, 'createdBy' | 'phase' | 'questionCount' | 'attemptCount'> & { attemptCount: number })[];
  scheduledExams: Omit<ExamSummary, 'createdBy' | 'phase' | 'questionCount' | 'attemptCount'>[];
  recentSubmissions: {
    id: string;
    submittedAt: string;
    student: { name: string };
    exam: { id: string; title: string };
    result: { status: ResultStatus; percentage: number } | null;
  }[];
  examPerformance: { examId: string; title: string; average: number; passRate: number; submissions: number }[];
}

// ---------- Admin ----------
export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: Role | null;
  action: string;
  outcome: AuditOutcome;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { id?: string; name: string; email?: string; role: Role } | null;
}

export interface AdminDashboard {
  stats: {
    students: number; faculty: number; admins: number; exams: number; publishedExams: number; liveExams: number;
    submissions: number; pendingReview: number; pendingApprovals: number; awaitingPublication: number;
  };
  registrations: { date: string; count: number }[];
  submissions: { date: string; count: number }[];
  accountStatus: { status: UserStatus; count: number }[];
  examStatus: { status: ExamStatus; count: number }[];
  pendingApprovals: (Omit<ExamSummary, 'phase' | 'attemptCount'>)[];
  recentActivity: AuditLogEntry[];
  generatedAt: string;
}

export interface AdminResultRow extends ResultRecord {
  released: boolean;
  student: { id: string; name: string; email: string };
  exam: { id: string; title: string; subject: string; status: ExamStatus; resultRelease: ResultRelease; resultsPublishedAt: string | null; endsAt: string };
}

/** GET /admin/results/:id */
export interface AdminResultDetail extends ResultRecord {
  released: boolean;
  student: { id: string; name: string; email: string; studentProfile: { rollNumber: string | null; department: string | null } | null };
  publishedBy: { name: string } | null;
  revisions: ResultRevision[];
  attempt: { id: string; attemptNumber: number; startedAt: string; submittedAt: string | null; submissionType: SubmissionType | null };
  exam: {
    id: string; title: string; subject: string; status: ExamStatus; totalMarks: number; passMarks: number; negativeMarking: boolean;
    negativeMarkRatio: number; resultRelease: ResultRelease; resultsPublishedAt: string | null; endsAt: string; createdBy: { id: string; name: string };
  };
  questions: (Question & { answer: ReviewAnswer | null })[];
}

export interface ResultsReport {
  rows: {
    examId: string; title: string; subject: string; faculty: string; status: ExamStatus; phase: ExamPhase; startsAt: string;
    totalMarks: number; attempts: number; submissions: number; graded: number; pendingReview: number; released: number;
    averagePercentage: number | null; passRate: number | null; highestScore: number | null; lowestScore: number | null;
  }[];
  subjects: { subject: string; exams: number; graded: number; averagePercentage: number | null; passRate: number | null }[];
  totals: { exams: number; submissions: number; graded: number; pendingReview: number; averagePercentage: number | null; passRate: number | null };
  availableSubjects: string[];
  filters: { from?: string; to?: string; subject?: string; examId?: string };
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  recipients: number;
  createdById: string | null;
  createdAt: string;
  createdBy?: { name: string; role: Role } | null;
}

export interface AdminSettingsResponse {
  settings: SystemSettings;
  meta: Record<string, { updatedAt: string; updatedBy: string | null }>;
}
