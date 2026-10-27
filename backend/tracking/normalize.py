"""Cleaning up a tracking number typed or pasted by a person.

People paste "3s abc 1234 567", "  3SABC1234567\n" or the whole courier link
("https://jouw.postnl.nl/track-and-trace/3SABC1234567-NL-1234AB"). Before we
save or look anything up, it becomes one clean form: 3SABC1234567.
"""

import re

# Courier tracking numbers are letters, digits and sometimes a dash. Anything
# else (spaces, dots, slashes) is typing noise.
_NOISE = re.compile(r"[^A-Z0-9-]")

# Real tracking numbers are at least this long; "123" is a typo.
MIN_LENGTH = 6
MAX_LENGTH = 64


class InvalidTrackingNumber(ValueError):
    """The text cannot be a tracking number. The message says why."""


def normalize_tracking_number(value):
    """Return the cleaned-up tracking number, or raise InvalidTrackingNumber.

    Examples:
        " 3s abc 1234 567 " -> "3SABC1234567"
        "https://jouw.postnl.nl/track-and-trace/3SABC1234567-NL-1234AB"
            -> "3SABC1234567"   (the code is the first part of the last segment)
    """
    text = (value or "").strip()
    if not text:
        raise InvalidTrackingNumber("Enter a tracking number.")

    # A pasted link: the tracking number is in the last part of the path.
    if text.lower().startswith(("http://", "https://")):
        last_part = text.rstrip("/").rsplit("/", 1)[-1]
        # Drop a query string ("?lang=nl") and PostNL's "-NL-1234AB" postcode tail.
        last_part = last_part.split("?", 1)[0]
        text = last_part.split("-", 1)[0]

    cleaned = _NOISE.sub("", text.upper()).strip("-")

    if len(cleaned) < MIN_LENGTH:
        raise InvalidTrackingNumber("That is too short to be a tracking number.")
    if len(cleaned) > MAX_LENGTH:
        raise InvalidTrackingNumber(f"A tracking number is at most {MAX_LENGTH} characters.")
    # Every courier's numbers contain digits; a word ("SCRIPT", "TRACKING") is not one.
    if not any(character.isdigit() for character in cleaned):
        raise InvalidTrackingNumber("A tracking number contains digits.")
    return cleaned
