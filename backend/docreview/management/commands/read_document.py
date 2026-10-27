"""Try the AI document reader on one file, from the terminal.

    python manage.py read_document path/to/receipt.pdf
    python manage.py read_document label.jpg --context "E-mail subject: your order"

For checking that OPENAI_API_KEY works and seeing what the AI reads, without
going through the website. Nothing is saved: no job is created and no record
is changed. It prints, step by step:

  1. what the AI read (the fields),
  2. the checks (docreview/validation.py) - e.g. a number not in the text,
  3. which existing records the exact lookups would match (docreview/matching.py).

Each run is one paid OpenAI API call.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from docreview import ai, pipeline
from docreview.matching import find_candidates
from docreview.models import DocumentJob
from docreview.validation import clean


class Command(BaseCommand):
    help = "Read one file with the AI document reader and show what it found (saves nothing)."

    def add_arguments(self, parser):
        parser.add_argument("path", help="A PDF, PNG, JPEG or WebP file, or a .txt file (read as an e-mail).")
        parser.add_argument("--context", default="", help="Extra text that came with it, e.g. an e-mail subject.")

    def handle(self, *args, **options):
        path = Path(options["path"])
        if not path.is_file():
            raise CommandError(f"No such file: {path}")
        data = path.read_bytes()

        content_type, _ = pipeline.detect_type(data)
        if content_type is None:
            if path.suffix.lower() != ".txt":
                raise CommandError("Only PDF, PNG, JPEG, WebP or .txt files can be read.")
            content_type = "text/plain"

        self.stdout.write(f"Reading {path.name} ({content_type}, {len(data) // 1024} KB) ...")
        try:
            fields, info = ai.read_document(data, content_type, options["context"])
        except ai.ExtractionError as error:
            raise CommandError(f"Reading failed: {error}") from error

        self.stdout.write(
            self.style.SUCCESS(
                f"\nRead by {info['model']} ({info['input_tokens']} tokens in, {info['output_tokens']} out)."
            )
        )

        # Step 1: what the AI read (the transcription separately, it is long).
        text = fields.get("text", "")
        shown = {key: value for key, value in fields.items() if key != "text"}
        self.stdout.write("\n1. Fields read:")
        self.stdout.write(json.dumps(shown, indent=2, ensure_ascii=False))
        self.stdout.write(f"\n   Text read (first 500 characters):\n   {text[:500]!r}")

        # Step 2: the checks, against the AI's text plus a PDF's own text layer.
        layer = pipeline.pdf_text(data) if content_type == "application/pdf" else ""
        extracted, issues = clean(fields, "\n".join(part for part in (text, layer) if part))
        self.stdout.write("\n2. Checks:")
        if not issues:
            self.stdout.write(self.style.SUCCESS("   Everything passed."))
        for item in issues:
            self.stdout.write(self.style.WARNING(f"   {item['field']}: {item['message']}"))

        # Step 3: the exact lookups, on an unsaved job (so nothing is written).
        job = DocumentJob(source=DocumentJob.Source.STAFF_UPLOAD, rejected={})
        proposals = find_candidates(job, extracted, issues)
        self.stdout.write("\n3. Matching records in the database:")
        for entity, candidates in proposals.items():
            if not candidates:
                self.stdout.write(f"   {entity}: none")
            for candidate in candidates:
                strength = "reliable" if candidate["strong"] else "uncertain"
                self.stdout.write(f"   {entity}: {candidate['label']} ({strength}) - {'; '.join(candidate['reasons'])}")
