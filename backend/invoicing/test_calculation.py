"""The invoice arithmetic, checked against the shared examples.

The examples live in invoicing/fixtures/calculation_cases.json. The frontend
runs the same file through its JavaScript copy of these rules
(invoiceMath.test.js), so if either side changes a rule without the other,
one of the two test suites fails.
"""

import json
from decimal import Decimal
from pathlib import Path

from django.test import SimpleTestCase

from .calculation import (
    calculate_totals,
    chargeable_weight,
    insurance_fee,
    is_credit,
    measure_packages,
)

CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "calculation_cases.json").read_text(encoding="utf-8")
)


class SharedTotalsTests(SimpleTestCase):
    def test_every_shared_totals_case(self):
        for case in CASES["totals"]:
            with self.subTest(case["name"]):
                totals = calculate_totals(case["charges"], case["adjustments"], case["vat_rate"])
                got = {key: str(totals[key]) for key in case["expected"]}
                self.assertEqual(got, case["expected"])

    def test_every_shared_package_case(self):
        for case in CASES["packages"]:
            with self.subTest(case["name"]):
                measured = measure_packages(case["measurements"])
                self.assertEqual(measured["pieces"], case["expected"]["pieces"])
                self.assertEqual(str(measured["volume_m3"]), case["expected"]["volume_m3"])
                self.assertEqual(
                    str(measured["volume_weight_kg"]), case["expected"]["volume_weight_kg"]
                )

    def test_every_shared_insurance_case(self):
        for case in CASES["insurance"]:
            with self.subTest(case["name"]):
                fee = insurance_fee(case["insured_value"], case["rate"], case["minimum"])
                self.assertEqual(None if fee is None else str(fee), case["expected"])


class RuleTests(SimpleTestCase):
    def test_a_credit_is_a_negative_total(self):
        self.assertTrue(is_credit(Decimal("-0.01")))
        self.assertFalse(is_credit(Decimal("0")))
        self.assertFalse(is_credit(None))

    def test_zero_vat_on_a_credit_is_not_minus_zero(self):
        totals = calculate_totals([], ["-10.00"], "0")

        self.assertEqual(str(totals["vat"]), "0.00")

    def test_air_freight_charges_the_heavier_of_the_two_weights(self):
        self.assertEqual(chargeable_weight(Decimal("100"), Decimal("160")), Decimal("160"))
        self.assertEqual(chargeable_weight(Decimal("200"), Decimal("160")), Decimal("200"))
        self.assertEqual(chargeable_weight(None, Decimal("160")), Decimal("160"))
        self.assertIsNone(chargeable_weight(None, None))
