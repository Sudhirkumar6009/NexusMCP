"""Deterministic event-source workflow orchestrator with predefined DAG templates."""

from __future__ import annotations

from typing import Any, Dict, List, Set

from ..models import EventWorkflowPlan, EventWorkflowStep


class EventWorkflowOrchestrator:
    """Map incoming events to one predefined workflow and emit a strict DAG plan."""

    ALLOWED_TOOLS: Set[str] = {
        "jira.get_issue",
        "jira.create_issue",
        "github.create_branch",
        "github.get_pr",
        "slack.send_message",
        "spreadsheet.add_row",
        "gmail.send_email",
    }

    def build_plan(self, event: Dict[str, Any]) -> EventWorkflowPlan:
        source = self._normalize_source(event.get("source"))
        if source == "jira":
            plan = self._build_jira_plan(event)
        elif source == "github":
            plan = self._build_github_plan(event)
        elif source == "slack":
            plan = self._build_slack_plan(event)
        else:
            raise ValueError(
                "Unsupported event source. Expected one of: jira, github, slack"
            )

        self._validate_plan(plan)
        return plan

    @staticmethod
    def _normalize_source(value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return value.strip().lower()

    @staticmethod
    def _event_value(event: Dict[str, Any], keys: List[str], default: Any) -> Any:
        for key in keys:
            value = event.get(key)
            if value is not None and value != "":
                return value
        return default

    def _resolve_jira_trigger(self, event: Dict[str, Any]) -> str:
        raw_trigger = str(
            event.get("trigger")
            or event.get("event_type")
            or event.get("type")
            or event.get("action")
            or ""
        ).lower()
        if "update" in raw_trigger:
            return "jira.issue_updated"
        return "jira.issue_created"

    def _resolve_github_trigger(self, event: Dict[str, Any]) -> str:
        raw_trigger = str(
            event.get("trigger")
            or event.get("event_type")
            or event.get("type")
            or event.get("action")
            or ""
        ).lower()

        if any(token in raw_trigger for token in ("pr", "pull", "merge_request")):
            return "github.pr_opened"

        if any(token in raw_trigger for token in ("branch", "push", "ref")):
            return "github.branch_created"

        if any(event.get(key) for key in ("pr_number", "pr", "pull_request")):
            return "github.pr_opened"

        return "github.branch_created"

    def _resolve_slack_trigger(self, event: Dict[str, Any]) -> str:
        raw_trigger = str(
            event.get("trigger")
            or event.get("event_type")
            or event.get("type")
            or event.get("action")
            or ""
        ).lower()

        if "command" in raw_trigger or event.get("command"):
            return "slack.command_received"
        return "slack.message_received"

    def _build_jira_plan(self, event: Dict[str, Any]) -> EventWorkflowPlan:
        issue_id = self._event_value(
            event,
            ["issue_id", "issueId", "id"],
            "{{event.issue_id}}",
        )
        email_to = self._event_value(
            event,
            ["notify_email", "email", "recipient_email"],
            "{{event.notify_email}}",
        )

        return EventWorkflowPlan(
            workflow="JIRA_START_WORKFLOW",
            trigger=self._resolve_jira_trigger(event),
            steps=[
                EventWorkflowStep(
                    id="1",
                    tool="jira.get_issue",
                    input={"issue_id": issue_id},
                    depends_on=[],
                ),
                EventWorkflowStep(
                    id="2",
                    tool="github.create_branch",
                    input={
                        "branch_name": "{{steps.1.output.issue_title_slug}}",
                        "issue_id": "{{steps.1.output.issue_id}}",
                    },
                    depends_on=["1"],
                ),
                EventWorkflowStep(
                    id="3",
                    tool="slack.send_message",
                    input={
                        "message": "Jira issue {{steps.1.output.issue_key}}: "
                        "{{steps.1.output.title}} ({{steps.1.output.status}})",
                    },
                    depends_on=["1"],
                ),
                EventWorkflowStep(
                    id="4",
                    tool="spreadsheet.add_row",
                    input={
                        "issue_id": "{{steps.1.output.issue_id}}",
                        "issue_key": "{{steps.1.output.issue_key}}",
                        "issue_title": "{{steps.1.output.title}}",
                        "branch_name": "{{steps.2.output.branch_name}}",
                        "slack_message_id": "{{steps.3.output.message_id}}",
                    },
                    depends_on=["1", "2", "3"],
                ),
                EventWorkflowStep(
                    id="5",
                    tool="gmail.send_email",
                    input={
                        "to": email_to,
                        "subject": "Issue {{steps.1.output.issue_key}} processed",
                        "body": "Branch {{steps.2.output.branch_name}} created, "
                        "Slack message {{steps.3.output.message_id}} sent, "
                        "Spreadsheet row {{steps.4.output.row_id}} added.",
                    },
                    depends_on=["1", "2", "3", "4"],
                ),
            ],
        )

    def _build_github_plan(self, event: Dict[str, Any]) -> EventWorkflowPlan:
        pr_number = self._event_value(
            event,
            ["pr_number", "pull_request_number", "pr"],
            "{{event.pr_number}}",
        )
        repo = self._event_value(
            event,
            ["repo", "repository", "repo_name"],
            "{{event.repo}}",
        )
        branch_name = self._event_value(
            event,
            ["branch_name", "branch", "ref"],
            "{{event.branch_name}}",
        )
        email_to = self._event_value(
            event,
            ["notify_email", "email", "recipient_email"],
            "{{event.notify_email}}",
        )

        return EventWorkflowPlan(
            workflow="GITHUB_START_WORKFLOW",
            trigger=self._resolve_github_trigger(event),
            steps=[
                EventWorkflowStep(
                    id="1",
                    tool="github.get_pr",
                    input={
                        "pr_number": pr_number,
                        "repo": repo,
                        "branch_name": branch_name,
                    },
                    depends_on=[],
                ),
                EventWorkflowStep(
                    id="2",
                    tool="jira.get_issue",
                    input={"issue_id": "{{steps.1.output.linked_issue_id}}"},
                    depends_on=["1"],
                ),
                EventWorkflowStep(
                    id="3",
                    tool="slack.send_message",
                    input={
                        "message": "GitHub update for {{steps.1.output.reference}} "
                        "linked to Jira {{steps.2.output.issue_key}}",
                    },
                    depends_on=["1", "2"],
                ),
                EventWorkflowStep(
                    id="4",
                    tool="spreadsheet.add_row",
                    input={
                        "repo": "{{steps.1.output.repo}}",
                        "reference": "{{steps.1.output.reference}}",
                        "jira_issue": "{{steps.2.output.issue_key}}",
                        "slack_message_id": "{{steps.3.output.message_id}}",
                    },
                    depends_on=["1", "2", "3"],
                ),
                EventWorkflowStep(
                    id="5",
                    tool="gmail.send_email",
                    input={
                        "to": email_to,
                        "subject": "GitHub workflow summary: {{steps.1.output.reference}}",
                        "body": "Jira link {{steps.2.output.issue_key}}, "
                        "Slack message {{steps.3.output.message_id}}, "
                        "Spreadsheet row {{steps.4.output.row_id}}.",
                    },
                    depends_on=["1", "2", "3", "4"],
                ),
            ],
        )

    def _build_slack_plan(self, event: Dict[str, Any]) -> EventWorkflowPlan:
        channel = self._event_value(
            event,
            ["channel", "channel_id"],
            "{{event.channel}}",
        )
        message_text = self._event_value(
            event,
            ["text", "message", "command"],
            "{{event.text}}",
        )
        email_to = self._event_value(
            event,
            ["notify_email", "email", "recipient_email"],
            "{{event.notify_email}}",
        )

        return EventWorkflowPlan(
            workflow="SLACK_START_WORKFLOW",
            trigger=self._resolve_slack_trigger(event),
            steps=[
                EventWorkflowStep(
                    id="1",
                    tool="slack.send_message",
                    input={
                        "channel": channel,
                        "message": "Intent parsed from Slack input: "
                        f"{message_text}",
                    },
                    depends_on=[],
                ),
                EventWorkflowStep(
                    id="2",
                    tool="jira.create_issue",
                    input={
                        "summary": "{{steps.1.output.intent_summary}}",
                        "description": "{{steps.1.output.intent_details}}",
                        "create_if_required": "{{steps.1.output.requires_jira_issue}}",
                    },
                    depends_on=["1"],
                ),
                EventWorkflowStep(
                    id="3",
                    tool="github.create_branch",
                    input={
                        "branch_name": "{{steps.2.output.issue_key}}-workflow",
                        "create_if_required": "{{steps.1.output.requires_branch}}",
                    },
                    depends_on=["2"],
                ),
                EventWorkflowStep(
                    id="4",
                    tool="spreadsheet.add_row",
                    input={
                        "intent": "{{steps.1.output.intent_summary}}",
                        "jira_issue": "{{steps.2.output.issue_key}}",
                        "branch_name": "{{steps.3.output.branch_name}}",
                        "channel": channel,
                    },
                    depends_on=["1", "2", "3"],
                ),
                EventWorkflowStep(
                    id="5",
                    tool="gmail.send_email",
                    input={
                        "to": email_to,
                        "subject": "Slack workflow confirmation",
                        "body": "Intent {{steps.1.output.intent_summary}} processed. "
                        "Jira {{steps.2.output.issue_key}}, "
                        "Branch {{steps.3.output.branch_name}}, "
                        "Spreadsheet row {{steps.4.output.row_id}}.",
                    },
                    depends_on=["1", "2", "3", "4"],
                ),
            ],
        )

    def _validate_plan(self, plan: EventWorkflowPlan) -> None:
        if len(plan.steps) != 5:
            raise ValueError("Each predefined workflow must contain exactly 5 steps")

        step_ids: Set[str] = set()
        completed_ids: Set[str] = set()

        for index, step in enumerate(plan.steps):
            if step.id in step_ids:
                raise ValueError(f"Duplicate step id detected: {step.id}")
            step_ids.add(step.id)

            if step.tool not in self.ALLOWED_TOOLS:
                raise ValueError(f"Unsupported tool in workflow plan: {step.tool}")

            if index == 0 and step.depends_on:
                raise ValueError("First step must not have dependencies")

            for dependency in step.depends_on:
                if dependency == step.id:
                    raise ValueError("A step cannot depend on itself")
                if dependency not in completed_ids:
                    raise ValueError(
                        f"Dependency must reference an earlier step: {dependency}"
                    )

            completed_ids.add(step.id)
