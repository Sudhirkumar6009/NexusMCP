"""Agent role implementations for flow planning."""

from .base_agent import BaseAgent
from .jira_agent import JiraAgent, JiraOperation, JiraWorkflowPlan
from .github_agent import GitHubAgent, GitHubOperation, GitHubWorkflowPlan

__all__ = [
    "BaseAgent",
    "JiraAgent",
    "JiraOperation", 
    "JiraWorkflowPlan",
    "GitHubAgent",
    "GitHubOperation",
    "GitHubWorkflowPlan",
]
