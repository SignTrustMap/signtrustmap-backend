export interface SignRemedy {
  code: string;
  label: string;
}

export const SIGN_REMEDIES: readonly SignRemedy[] = [
  { code: 'SIGN_NOT_FOUND', label: 'Không tìm thấy biển báo' },
  { code: 'INCORRECT_SIGN_TYPE', label: 'Sai loại biển báo' },
  { code: 'POOR_IMAGE_QUALITY', label: 'Chất lượng ảnh quá kém' },
  { code: 'DUPLICATE_SUBMISSION', label: 'Dữ liệu bị trùng lặp' },
];
