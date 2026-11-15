import os
import unittest
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, insert, select

os.environ.setdefault(
    "SYNC_DATABASE_URL",
    "postgresql+psycopg://stm_user:stm_password@localhost:5433/signtrustmap",
)

from app.db_sync import get_sync_db
from app.models.pipeline import (
    CandidateDetectionMetadata,
    CandidateGeoEstimation,
    SurveySubmission,
    UnverifiedSignCandidate,
)
from app.tasks.ai_pipeline import _persist_candidates


class CandidateIdPersistenceIntegrationTests(unittest.TestCase):
    SUBMISSION_ID = uuid.UUID("c0000000-0000-0000-0000-000000000001")
    SURVEYOR_ID = uuid.UUID("f42b57a0-1beb-4463-abee-ab768e454949")
    EXPECTED_CANDIDATE_ID = uuid.UUID("a3bb189e-8bf9-3888-9912-ace4e6543002")

    def setUp(self) -> None:
        self._cleanup()
        with get_sync_db() as db:
            db.execute(
                insert(SurveySubmission).values(
                    id=self.SUBMISSION_ID,
                    surveyor_id=self.SURVEYOR_ID,
                    submission_type="VIDEO_GPX",
                    status="QUEUED",
                    captured_at=datetime.now(timezone.utc),
                    coordinate_source="GPX_FILE",
                    validation_errors=[],
                    correction_requirements=[],
                    total_candidates_extracted=0,
                    reward_status="NONE",
                    reward_amount=0,
                )
            )
            db.commit()

    def tearDown(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        with get_sync_db() as db:
            subquery = (
                select(UnverifiedSignCandidate.id)
                .where(UnverifiedSignCandidate.submission_id == self.SUBMISSION_ID)
            )
            db.execute(delete(CandidateGeoEstimation).where(CandidateGeoEstimation.candidate_id.in_(subquery)))
            db.execute(delete(CandidateDetectionMetadata).where(CandidateDetectionMetadata.candidate_id.in_(subquery)))
            db.execute(delete(UnverifiedSignCandidate).where(UnverifiedSignCandidate.submission_id == self.SUBMISSION_ID))
            db.execute(delete(SurveySubmission).where(SurveySubmission.id == self.SUBMISSION_ID))
            db.commit()

    def test_persist_candidates_uses_deterministic_candidate_id_from_ai(self) -> None:
        ai_signs = [
            {
                "candidate_id": str(self.EXPECTED_CANDIDATE_ID),
                "class_name": "P.102",
                "confidence": 0.95,
                "best_frame_key": "stm-raw-videos/sub-test/frame.jpg",
                "sign_crop_key": "stm-sign-crops/sub-test/crop.jpg",
                "box_xyxy": [100.0, 150.0, 300.0, 450.0],
                "track_id": 1,
                "frame_index": 0,
                "timestamp_seconds": 1.5,
            }
        ]

        inserted, unmapped = _persist_candidates(
            submission_id=str(self.SUBMISSION_ID),
            signs=ai_signs,
            gpx_points=None,
            captured_at=datetime.now(timezone.utc),
            image_width=1920,
            image_height=1080,
            metadata={"note": "GPS: 21.0285, 105.8342"},
        )

        self.assertEqual(inserted, 1)
        self.assertEqual(unmapped, 0)

        with get_sync_db() as db:
            candidate_ids = db.execute(
                select(UnverifiedSignCandidate.id)
                .where(UnverifiedSignCandidate.submission_id == self.SUBMISSION_ID)
            ).scalars().all()

            self.assertEqual(len(candidate_ids), 1)
            saved_id = candidate_ids[0]

            self.assertEqual(
                saved_id,
                self.EXPECTED_CANDIDATE_ID,
                f"Candidate ID was not respected: got {saved_id}, expected {self.EXPECTED_CANDIDATE_ID}",
            )


if __name__ == "__main__":
    unittest.main()
