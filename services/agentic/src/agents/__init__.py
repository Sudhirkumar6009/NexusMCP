"""Agent role implementations for flow planning."""

from .base_agent import BaseAgent
from .jira_agent import JiraAgent, JiraOperation, JiraWorkflowPlan
from .github_agent import GitHubAgent, GitHubOperation, GitHubWorkflowPlan
from .slack_agent import SlackAgent, SlackOperation, SlackWorkflowPlan
from .sheets_agent import GoogleSheetsAgent, SheetsOperation, SheetsWorkflowPlan
from .gmail_agent import GmailAgent, GmailOperation, GmailWorkflowPlan
from .event_workflow_orchestrator import EventWorkflowOrchestrator

__all__ = [
    "BaseAgent",
    "JiraAgent",
    "JiraOperation",
    "JiraWorkflowPlan",
    "GitHubAgent",
    "GitHubOperation",
    "GitHubWorkflowPlan",
    "SlackAgent",
    "SlackOperation",
    "SlackWorkflowPlan",
    "GoogleSheetsAgent",
    "SheetsOperation",
    "SheetsWorkflowPlan",
    "GmailAgent",
    "GmailOperation",
    "GmailWorkflowPlan",
    "EventWorkflowOrchestrator",
]
