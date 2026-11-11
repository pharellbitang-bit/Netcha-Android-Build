"""Offline checks for the Android WebView's user-reporting controls."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI_PATH = ROOT / "www" / "index.html"


class AndroidReportingUiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ui = UI_PATH.read_text(encoding="utf-8")

    def test_report_helper_uses_only_supported_target_types(self):
        used = set(re.findall(r"boutonSignalementNetcha\('([^']+)'", self.ui))
        self.assertTrue(used)
        self.assertLessEqual(used, {"compte", "publication", "message", "story"})

    def test_every_android_ugc_surface_has_a_report_action(self):
        markers = {
            "member accounts": "boutonSignalementNetcha('compte'",
            "Marketplace listings": "Signaler cette annonce",
            "Marketplace seller profile": "marketMerchantReport",
            "Marketplace comments": "commentaire_produit:",
            "private and group messages": "boutonSignalementNetcha('message'",
            "stories": "boutonSignalementNetcha('story'",
            "story and circle comments": "boutonSignalementNetcha('publication','commentaire:",
            "circle suggestion cards": "boutonSignalementNetcha('publication','cercle:'+x.id,x.createur_id,'Signaler')",
            "circle itself": "Signaler ce cercle",
            "circle publications": "boutonSignalementNetcha('publication',p.id,p.auteur_id)",
            "Flash": "boutonSignalementNetcha('publication','flash:'",
            "events": "boutonSignalementNetcha('publication','evenement:'",
        }
        for surface, marker in markers.items():
            with self.subTest(surface=surface):
                self.assertIn(marker, self.ui)

    def test_ui_posts_reports_to_shared_api(self):
        self.assertIn("requeteNetcha('/api/reports'", self.ui)
        self.assertIn("cible_type:'produit'", self.ui)


if __name__ == "__main__":
    unittest.main()
