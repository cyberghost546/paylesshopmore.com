"""The chat assistant's endpoint: GET says whether it is on, POST asks it.

Open to anonymous visitors - the chat is for people deciding whether to ship
with us - so, like the contact form, it is throttled per visitor and carries
a site-wide ceiling (config/abuse.py) on top. Here that ceiling is also the
cap on the OpenAI bill: at most ASSISTANT site-limit calls an hour, whatever
anybody does.

Nothing is stored. The browser keeps the conversation and sends it whole
with every message; the size limits below keep that, and the cost of each
call, bounded.
"""

import logging

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from config import abuse

from . import ai

logger = logging.getLogger(__name__)

# The conversation the browser may send. Older messages are dropped by the
# browser before it gets this long (ChatAssistant keeps the last ones).
MAX_MESSAGES = 30
MAX_TEXT = 2000  # one message typed by the visitor (or an earlier answer)
MAX_TOOL_TEXT = 4000  # a tool call's arguments or result, as JSON text
MAX_ID = 100
LANGUAGES = {"nl", "en", "pap"}


def clean_messages(raw):
    """Check the conversation the browser sent. Returns it, or raises ValidationError.

    Only the shapes ai.to_openai_input knows are let through, and only tools
    the assistant has: a crafted request cannot slip anything else into the
    call.
    """
    if not isinstance(raw, list) or not raw:
        raise ValidationError({"messages": "Send the conversation as a non-empty list."})
    if len(raw) > MAX_MESSAGES:
        raise ValidationError({"messages": f"At most {MAX_MESSAGES} messages."})

    cleaned = []
    for message in raw:
        if not isinstance(message, dict):
            raise ValidationError({"messages": "Each message must be an object."})
        kind = message.get("type", "message")
        call_id = message.get("call_id")

        if kind in ("function_call", "function_call_output"):
            if not isinstance(call_id, str) or not 0 < len(call_id) <= MAX_ID:
                raise ValidationError({"messages": "A tool message needs a call_id."})
            text_key = "arguments" if kind == "function_call" else "output"
            text = message.get(text_key)
            if not isinstance(text, str) or len(text) > MAX_TOOL_TEXT:
                raise ValidationError(
                    {"messages": f"A tool message needs {text_key} (at most {MAX_TOOL_TEXT} characters)."}
                )
            item = {"type": kind, "call_id": call_id, text_key: text}
            if kind == "function_call":
                if message.get("name") not in ai.TOOL_NAMES:
                    raise ValidationError({"messages": "Unknown tool."})
                item["name"] = message["name"]
            cleaned.append(item)
        elif kind == "message":
            role, content = message.get("role"), message.get("content")
            if role not in ("user", "assistant"):
                raise ValidationError({"messages": "role must be user or assistant."})
            if not isinstance(content, str) or not content.strip() or len(content) > MAX_TEXT:
                raise ValidationError({"messages": f"A message must be 1 to {MAX_TEXT} characters."})
            cleaned.append({"type": "message", "role": role, "content": content})
        else:
            raise ValidationError({"messages": "Unknown message type."})

    # A conversation the visitor is taking part in ends with something new
    # from their side: their message, or a tool result their browser made.
    if cleaned[-1]["type"] == "function_call" or cleaned[-1].get("role") == "assistant":
        raise ValidationError({"messages": "The last message must come from the visitor."})
    return cleaned


class AssistantView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "assistant"

    def get_throttles(self):
        # Only asking costs money; "is it on?" is asked on every page load
        # and must not use up the visitor's questions.
        if self.request.method == "POST":
            return [ScopedRateThrottle()]
        return []

    def get(self, request):
        return Response({"enabled": ai.is_configured()})

    def post(self, request):
        if not ai.is_configured():
            return Response(
                {"code": "assistant_off", "detail": "The assistant is not available."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        messages = clean_messages(request.data.get("messages"))
        language = request.data.get("language")
        language = language if language in LANGUAGES else "nl"
        page = request.data.get("page")
        # Only a path of this site, and short: it goes into the instructions.
        page = page[:100] if isinstance(page, str) and page.startswith("/") else "/"

        abuse.check("assistant")
        try:
            user = request.user if request.user.is_authenticated else None
            answer = ai.reply(messages, language=language, page=page, user=user)
        except ai.AssistantError:
            logger.exception("The chat assistant failed")
            return Response(
                {"code": "assistant_failed", "detail": "The assistant could not answer just now."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        abuse.record("assistant")
        return Response(answer)
