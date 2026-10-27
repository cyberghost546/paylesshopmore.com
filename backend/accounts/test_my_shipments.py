"""Tests for the journey details on a customer's own shipment list.

The profile page's "My shipments" opens each shipment to show where it is
and when it should arrive. What matters: the same reading as Track & Trace,
and still only the customer's own shipments.
"""

from datetime import date

from django.urls import reverse
from rest_framework import status

from .models import Address, Package
from .public import PUBLIC_STAGES
from .test_api import ApiTestCase, make_user


class MyShipmentJourneyTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user()
        self.address = Address.objects.create(
            user=self.user,
            street="Kaya Grandi",
            house_number="24",
            postal_code="0000",
            city="Willemstad",
            country=Address.Country.CURACAO,
            is_default=True,
        )
        self.client.force_authenticate(self.user)

    def make(self, number, status_value, **extra):
        return Package.objects.create(
            user=self.user,
            delivery_address=self.address,
            tracking_number=number,
            status=status_value,
            **extra,
        )

    def rows(self):
        response = self.client.get(reverse("package-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data["results"] if "results" in response.data else response.data
        return {row["tracking_number"]: row for row in data}

    def test_each_shipment_says_where_it_is_and_when_it_arrives(self):
        self.make(
            "PLSM-1",
            Package.Status.IN_TRANSIT,
            estimated_arrival=date(2026, 10, 15),
        )

        row = self.rows()["PLSM-1"]

        self.assertEqual(row["destination"], "Curaçao")
        self.assertEqual(row["progress"], 60)
        self.assertEqual(row["estimated_arrival"], "2026-10-15")
        stages = [stage["value"] for stage in row["stages"]]
        self.assertEqual(stages, [value for value, _ in PUBLIC_STAGES])
        self.assertEqual(stages[row["stage_index"]], "in_transit")

    def test_a_quote_and_a_cancelled_shipment_are_not_on_the_journey(self):
        self.make("PLSM-Q", Package.Status.QUOTED)
        self.make("PLSM-C", Package.Status.CANCELLED)

        rows = self.rows()

        self.assertEqual(rows["PLSM-Q"]["stage_index"], -1)
        self.assertEqual(rows["PLSM-C"]["stage_index"], -1)

    def test_still_only_the_customers_own_shipments(self):
        self.make("PLSM-MINE", Package.Status.PAID)
        stranger = make_user(username="other", email="someone-else@example.com")
        Package.objects.create(
            user=stranger, tracking_number="PLSM-THEIRS", status=Package.Status.PAID
        )

        self.assertEqual(set(self.rows()), {"PLSM-MINE"})


class HandoverChoiceTests(ApiTestCase):
    """The customer chooses delivery or pickup for their own shipment."""

    def setUp(self):
        super().setUp()
        self.user = make_user()
        self.client.force_authenticate(self.user)
        self.package = Package.objects.create(
            user=self.user, tracking_number="PLSM-H1", status=Package.Status.IN_TRANSIT
        )

    def choose(self, value, package=None):
        package = package or self.package
        return self.client.post(
            reverse("package-handover", args=[package.pk]), {"handover": value}, format="json"
        )

    def test_choosing_pickup_changes_the_last_step(self):
        response = self.choose("pickup")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["handover"], "pickup")
        self.assertEqual(response.data["stages"][-1]["value"], "picked_up")
        self.package.refresh_from_db()
        self.assertEqual(self.package.handover, "pickup")

    def test_the_customer_chooses_only_once(self):
        self.choose("pickup")
        response = self.choose("delivery")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.package.refresh_from_db()
        self.assertEqual(self.package.handover, "pickup")
        self.assertIsNotNone(self.package.handover_chosen_at)

    def test_choosing_what_it_already_is_still_locks_it(self):
        self.assertEqual(self.choose("delivery").status_code, status.HTTP_200_OK)
        self.assertEqual(self.choose("pickup").status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_delivery_or_pickup(self):
        self.assertEqual(self.choose("drone").status_code, status.HTTP_400_BAD_REQUEST)

    def test_not_once_it_is_delivered(self):
        Package.objects.filter(pk=self.package.pk).force_update(status=Package.Status.DELIVERED)
        self.assertEqual(self.choose("pickup").status_code, status.HTTP_400_BAD_REQUEST)

    def test_not_for_somebody_elses_shipment(self):
        stranger = make_user(username="stranger", email="stranger@example.com")
        theirs = Package.objects.create(user=stranger, tracking_number="PLSM-H2")
        self.assertEqual(self.choose("pickup", theirs).status_code, status.HTTP_404_NOT_FOUND)
        theirs.refresh_from_db()
        self.assertEqual(theirs.handover, "delivery")


class HandoverMailTests(HandoverChoiceTests):
    """Changing "Delivery" / "Pick it up myself" mails the office and the customer."""

    def setUp(self):
        super().setUp()
        from django.contrib.auth import get_user_model

        User = get_user_model()
        self.office = User.objects.create_user(
            username="kantoor@example.com", email="kantoor@example.com",
            password="a-long-enough-password", role=User.Role.OFFICE,
        )
        self.user.language = "en"
        self.user.save()

    def choose_and_send(self, value):
        from django.core import mail

        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.choose(value)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return mail.outbox

    def test_a_change_mails_the_office_and_confirms_to_the_customer(self):
        outbox = self.choose_and_send("pickup")

        self.assertEqual(len(outbox), 2)
        office, customer = outbox
        self.assertEqual(office.to, ["kantoor@example.com"])
        self.assertIn("PLSM-H1", office.subject)
        self.assertIn("pick it up myself", office.body)
        self.assertIn("Was:          delivery", office.body)
        self.assertEqual(customer.to, [self.user.email])
        self.assertIn("pick it up myself", customer.body)

    def test_choosing_what_it_already_is_sends_nothing(self):
        self.assertEqual(self.choose_and_send("delivery"), [])

    def test_the_customer_hears_it_in_their_language(self):
        self.user.language = "nl"
        self.user.save()
        outbox = self.choose_and_send("pickup")
        self.assertIn("zelf ophalen", outbox[-1].body)
