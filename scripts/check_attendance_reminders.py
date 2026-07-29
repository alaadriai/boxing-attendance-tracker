#!/usr/bin/env python3
"""Send one email when a scheduled boxing session is still missing after 10 hours."""

from __future__ import annotations

import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo


BERLIN = ZoneInfo("Europe/Berlin")
REMINDER_DELAY = timedelta(hours=10)
MAX_LATE_DELIVERY = timedelta(hours=24)


@dataclass(frozen=True)
class Course:
    course_id: str
    name: str
    weekday: int
    starts_at: time


COURSES = (
    Course("c1", "Boxing Level 1", 0, time(20, 0)),
    Course("c2", "Boxing Fitness", 0, time(21, 30)),
    Course("c3", "Boxing Level 1 to 2", 3, time(21, 30)),
)


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or not value.strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip()


def now_berlin() -> datetime:
    override = os.environ.get("CHECK_NOW")
    if not override:
        return datetime.now(BERLIN)
    parsed = datetime.fromisoformat(override)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=BERLIN)
    return parsed.astimezone(BERLIN)


def firestore_url(path: str) -> str:
    project = env("FIREBASE_PROJECT_ID")
    api_key = env("FIREBASE_API_KEY")
    quoted_path = "/".join(urllib.parse.quote(part, safe="") for part in path.split("/"))
    return (
        f"https://firestore.googleapis.com/v1/projects/{project}"
        f"/databases/(default)/documents/{quoted_path}?key={urllib.parse.quote(api_key)}"
    )


def request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict | None = None,
    allow_not_found: bool = False,
) -> dict | None:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if allow_not_found and exc.code == 404:
            return None
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Firestore request failed ({exc.code}): {detail}") from exc


def field_string(document: dict, field: str) -> str:
    return document.get("fields", {}).get(field, {}).get("stringValue", "")


def fetch_sessions() -> set[tuple[str, str]]:
    result = request_json(firestore_url("sessions") + "&pageSize=1000") or {}
    return {
        (field_string(document, "courseId"), field_string(document, "date"))
        for document in result.get("documents", [])
        if field_string(document, "type") != "reminder"
    }


def due_courses(now: datetime) -> list[tuple[Course, date, datetime]]:
    due: list[tuple[Course, date, datetime]] = []
    for days_ago in range(3):
        course_date = now.date() - timedelta(days=days_ago)
        for course in COURSES:
            if course_date.weekday() != course.weekday:
                continue
            starts = datetime.combine(course_date, course.starts_at, BERLIN)
            deadline = starts + REMINDER_DELAY
            if deadline <= now <= deadline + MAX_LATE_DELIVERY:
                due.append((course, course_date, deadline))
    return due


def reminder_id(course: Course, course_date: date) -> str:
    return f"reminder_{course.course_id}_{course_date.isoformat()}"


def reminder_already_sent(course: Course, course_date: date) -> bool:
    marker = request_json(
        firestore_url(f"sessions/{reminder_id(course, course_date)}"),
        allow_not_found=True,
    )
    return marker is not None


def send_email(course: Course, course_date: date, deadline: datetime) -> None:
    recipient = env("REMINDER_TO")
    sender = env("SMTP_USERNAME")
    password = env("SMTP_PASSWORD")
    tracker_url = env(
        "TRACKER_URL",
        "https://alaadriai.github.io/boxing-attendance-tracker/",
    )

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = f"Attendance missing: {course.name} ({course_date:%d.%m.%Y})"
    message.set_content(
        "\n".join(
            (
                "The attendance for this boxing course has not been entered:",
                "",
                f"Course: {course.name}",
                f"Scheduled: {course_date:%A, %d.%m.%Y} at {course.starts_at:%H:%M}",
                f"Reminder threshold: {deadline:%d.%m.%Y at %H:%M} (Europe/Berlin)",
                "",
                f"Enter attendance: {tracker_url}",
                "",
                "This reminder is sent once for each missing course.",
            )
        )
    )

    host = env("SMTP_HOST", "smtp.gmail.com")
    port = int(env("SMTP_PORT", "465"))
    with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context()) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)


def mark_sent(course: Course, course_date: date, sent_at: datetime) -> None:
    payload = {
        "fields": {
            "type": {"stringValue": "reminder"},
            "courseId": {"stringValue": course.course_id},
            "courseDate": {"stringValue": course_date.isoformat()},
            "recipient": {"stringValue": env("REMINDER_TO")},
            "sentAt": {"timestampValue": sent_at.astimezone(ZoneInfo("UTC")).isoformat()},
        }
    }
    request_json(
        firestore_url(f"sessions/{reminder_id(course, course_date)}"),
        method="PATCH",
        payload=payload,
    )


def main() -> int:
    now = now_berlin()
    dry_run = os.environ.get("DRY_RUN", "").lower() in {"1", "true", "yes"}
    sessions = fetch_sessions()
    candidates = due_courses(now)
    print(f"Checking at {now.isoformat()}; due courses: {len(candidates)}")

    for course, course_date, deadline in candidates:
        key = (course.course_id, course_date.isoformat())
        if key in sessions:
            print(f"OK: {course.name} on {course_date} has an attendance entry")
            continue
        if reminder_already_sent(course, course_date):
            print(f"OK: reminder already sent for {course.name} on {course_date}")
            continue
        if dry_run:
            print(f"DRY RUN: would remind for {course.name} on {course_date}")
            continue

        send_email(course, course_date, deadline)
        mark_sent(course, course_date, now)
        print(f"SENT: {course.name} on {course_date}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
