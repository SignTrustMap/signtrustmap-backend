import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserReviewStatisticsDto {
  @ApiProperty({ description: 'Total review votes cast by this user', example: 142 })
  total: number;

  @ApiProperty({ description: 'Number of votes that matched the final consensus outcome', example: 135 })
  correct: number;

  @ApiProperty({ description: 'Number of votes that contradicted the final consensus outcome', example: 7 })
  wrong: number;

  @ApiProperty({ description: 'Number of votes cast on candidates still awaiting consensus resolution', example: 4 })
  pendingConsensus: number;

  @ApiProperty({ description: 'Total votes cast with +1 (approve sign)', example: 110 })
  votedApprove: number;

  @ApiProperty({ description: 'Total votes cast with -1 (reject sign)', example: 32 })
  votedReject: number;

  @ApiProperty({ description: 'Accuracy percentage: (correct / (correct + wrong)) * 100', example: 95.07 })
  accuracyRate: number;

  @ApiProperty({ description: 'Bayesian reliability score (0-100)', example: 97.4 })
  reliabilityScore: number;

  @ApiProperty({ description: 'Current consecutive correct review streak', example: 14 })
  currentStreak: number;

  @ApiProperty({ description: 'Current consecutive false review errors', example: 0 })
  consecutiveErrors: number;

  @ApiProperty({ description: 'Number of candidates skipped without voting', example: 3 })
  skipped: number;

  @ApiProperty({ description: 'Number of reviews flagged by peers or moderators', example: 0 })
  flagged: number;

  @ApiProperty({
    description: 'Reviewer standing: ACTIVE, PROVISIONAL (<5 votes), or SUSPENDED',
    enum: ['ACTIVE', 'PROVISIONAL', 'SUSPENDED'],
    example: 'ACTIVE',
  })
  standing: 'ACTIVE' | 'PROVISIONAL' | 'SUSPENDED';
}

export class UserSurveyStatisticsDto {
  @ApiProperty({ description: 'Total survey submissions created by this surveyor', example: 38 })
  total: number;

  @ApiProperty({ description: 'Submissions successfully processed and completed with candidates', example: 34 })
  accepted: number;

  @ApiProperty({ description: 'Submissions rejected during contract validation or corrupted media', example: 1 })
  rejected: number;

  @ApiProperty({ description: 'Submissions that crashed or failed in AI pipeline', example: 0 })
  failed: number;

  @ApiProperty({ description: 'Submissions processed where zero traffic signs were detected', example: 2 })
  noSignsDetected: number;

  @ApiProperty({ description: 'Submissions currently being processed in AI pipeline', example: 1 })
  pending: number;

  @ApiProperty({ description: 'Submissions requiring correction from surveyor', example: 0 })
  correctionRequired: number;

  @ApiProperty({
    description: 'Acceptance percentage: (accepted / (accepted + rejected + failed + noSignsDetected)) * 100',
    example: 91.89,
  })
  acceptanceRate: number;

  @ApiProperty({ description: 'Total raw sign candidates detected from this surveyor submissions', example: 182 })
  candidatesTotal: number;

  @ApiProperty({ description: 'Candidates that reached consensus approval and are active on live map', example: 165 })
  candidatesVerified: number;

  @ApiProperty({ description: 'Conversion rate: (candidatesVerified / candidatesTotal) * 100', example: 90.66 })
  verificationRate: number;

  @ApiProperty({ description: 'Average candidates detected per survey submission', example: 4.79 })
  averageYield: number;
}

export class UserHazardStatisticsDto {
  @ApiProperty({ description: 'Total road hazard reports submitted', example: 6 })
  totalReported: number;

  @ApiProperty({ description: 'Hazards confirmed by other community drivers', example: 5 })
  confirmed: number;

  @ApiProperty({ description: 'Hazards dismissed as false or non-existent', example: 1 })
  dismissed: number;

  @ApiProperty({ description: 'Hazards active and awaiting peer confirmations', example: 0 })
  unconfirmed: number;

  @ApiProperty({ description: 'Credibility ratio: (confirmed / (confirmed + dismissed)) * 100', example: 83.33 })
  confirmedRatio: number;

  @ApiProperty({ description: 'Cumulative confirmation upvotes received across all reports', example: 18 })
  confirmationsReceived: number;

  @ApiProperty({ description: 'Cumulative dismissal downvotes received across all reports', example: 2 })
  dismissalsReceived: number;
}

export class UserNavigationStatisticsDto {
  @ApiProperty({ description: 'Total navigation sessions started', example: 45 })
  totalSessions: number;

  @ApiProperty({ description: 'Navigation sessions successfully completed to destination', example: 42 })
  completed: number;

  @ApiProperty({ description: 'Navigation sessions aborted or cancelled mid-route', example: 3 })
  cancelled: number;

  @ApiProperty({ description: 'Navigation sessions currently active', example: 0 })
  active: number;
}

export class UserWalletStatisticsDto {
  @ApiProperty({ description: 'Current spendable wallet balance', example: 2450 })
  balance: number;

  @ApiProperty({ description: 'Whether the wallet is administratively frozen', example: false })
  isFrozen: boolean;

  @ApiProperty({ description: 'Lifetime cumulative credits earned', example: 5320 })
  totalCreditsEarned: number;
}

export class UserActivityStatisticsDto {
  @ApiProperty({ description: 'Number of revalidation evidence photos submitted for aging signs', example: 4 })
  revalidationsCompleted: number;

  @ApiProperty({ description: 'Number of completed daily gamification missions', example: 28 })
  dailyTasksCompleted: number;

  @ApiProperty({ description: 'Number of achievement badges unlocked', example: 4 })
  badgesUnlocked: number;

  @ApiPropertyOptional({ description: 'Most recent activity timestamp across reviews, surveys, or navigation', nullable: true })
  lastActiveAt: string | null;

  @ApiPropertyOptional({ description: 'Timestamp of most recent survey upload', nullable: true })
  lastSurveyAt: string | null;

  @ApiPropertyOptional({ description: 'Timestamp of most recent review vote', nullable: true })
  lastReviewAt: string | null;
}

export class UserStatisticsDto {
  @ApiProperty({ type: UserReviewStatisticsDto })
  reviews: UserReviewStatisticsDto;

  @ApiProperty({ type: UserSurveyStatisticsDto })
  surveys: UserSurveyStatisticsDto;

  @ApiProperty({ type: UserHazardStatisticsDto })
  hazards: UserHazardStatisticsDto;

  @ApiProperty({ type: UserNavigationStatisticsDto })
  navigation: UserNavigationStatisticsDto;

  @ApiProperty({ type: UserWalletStatisticsDto })
  wallet: UserWalletStatisticsDto;

  @ApiProperty({ type: UserActivityStatisticsDto })
  activity: UserActivityStatisticsDto;
}

export class UserDetailedStatisticsDto extends UserStatisticsDto {
  @ApiProperty({ description: 'User UUID', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  userId: string;

  @ApiProperty({ description: 'Full name', example: 'Nguyễn Văn An' })
  fullName: string;

  @ApiProperty({ description: 'User email', example: 'surveyor@signtrustmap.vn' })
  email: string;

  @ApiProperty({ description: 'Account status', example: 'ACTIVE' })
  status: string;

  @ApiProperty({ description: 'Assigned roles', example: ['SURVEYOR', 'REVIEWER'] })
  roles: string[];

  @ApiProperty({ description: 'Account registration timestamp' })
  joinedAt: string;

  @ApiPropertyOptional({ description: 'Recent review voting records', type: [Object] })
  recentReviews?: any[];

  @ApiPropertyOptional({ description: 'Recent survey submission records', type: [Object] })
  recentSubmissions?: any[];

  @ApiPropertyOptional({ description: 'Recent road hazard reports', type: [Object] })
  recentHazards?: any[];
}

export class PlatformUsersSummaryDto {
  @ApiProperty({ description: 'Total registered users in platform', example: 1450 })
  totalUsers: number;

  @ApiProperty({ description: 'User counts grouped by status' })
  usersByStatus: {
    active: number;
    suspended: number;
    banned: number;
  };

  @ApiProperty({ description: 'User counts grouped by role' })
  usersByRole: {
    surveyor: number;
    reviewer: number;
    driver: number;
    staff: number;
    admin: number;
  };

  @ApiProperty({ description: 'Consensus review community summary' })
  reviewsSummary: {
    totalVotesCast: number;
    totalCorrectVotes: number;
    totalFalseVotes: number;
    totalPendingConsensus: number;
    platformAccuracyRate: number;
    activeReviewers30d: number;
    reviewersSuspended: number;
  };

  @ApiProperty({ description: 'Survey contributions summary' })
  surveysSummary: {
    totalSubmissions: number;
    acceptedSubmissions: number;
    rejectedSubmissions: number;
    failedSubmissions: number;
    noSignsDetectedSubmissions: number;
    pendingSubmissions: number;
    platformAcceptanceRate: number;
    totalCandidatesDetected: number;
    totalVerifiedSignsGenerated: number;
    activeSurveyors30d: number;
  };

  @ApiProperty({ description: 'Road hazard peer-reporting summary' })
  hazardsSummary: {
    totalReported: number;
    confirmed: number;
    dismissed: number;
    unconfirmed: number;
    platformConfirmedRatio: number;
  };

  @ApiProperty({ description: 'Navigation sessions summary' })
  navigationSummary: {
    totalSessions: number;
    completedSessions: number;
    cancelledSessions: number;
    activeSessions: number;
  };
}
