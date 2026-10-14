export interface SignRemedySuggestion {
  rank: number;
  signTypeId: number | null;
  classId: number | null;
  standardCode: string | null;
  slug: string | null;
  nameVi: string | null;
  nameEn: string | null;
  confidence: number;
}
