"""Required API Agent - Identifies required services from query and checks connectivity."""

from __future__ import annotations

import re
from typing import Dict, List, Set, Tuple

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient
from ..models import IntegrationInput, RequiredAPIResult, RequiredService


# Service detection patterns
SERVICE_PATTERNS: Dict[str, List[str]] = {
    "jira": [
        r"\bjira\b",
        r"\bissue\b",
        r"\bticket\b",
        r"\bbug\b",
        r"\btask\b",
        r"\bstory\b",
        r"\bepic\b",
        r"\b[A-Z][A-Z0-9]+-\d+\b",  # Issue key pattern like ABC-123
    ],
    "github": [
        r"\bgithub\b",
        r"\brepo\b",
        r"\brepository\b",
        r"\bbranch\b",
        r"\bpull\s*request\b",
        r"\bpr\b",
        r"\bcommit\b",
        r"\bworkflow\b",
        r"\baction\b",
        r"\bmerge\b",
    ],
    "slack": [
        r"\bslack\b",
        r"\bmessage\b",
        r"\bnotify\b",
        r"\bnotification\b",
        r"\bchannel\b",
        r"\bpost\b",
        r"\bchat\b",
        r"\balert\b",
    ],
    "google_sheets": [
        r"\bsheet\b",
        r"\bsheets\b",
        r"\bspreadsheet\b",
        r"\brow\b",
        r"\bcell\b",
        r"\bappend\b",
        r"\blog\b",
        r"\brecord\b",
    ],
    "gmail": [
        r"\bgmail\b",
        r"\bemail\b",
        r"\bmail\b",
        r"\binbox\b",
        r"\bsend\s*mail\b",
    ],
    "aws": [
        r"\baws\b",
        r"\blambda\b",
        r"\bs3\b",
        r"\bec2\b",
        r"\bcloud\b",
    ],
}

SERVICE_ALIASES: Dict[str, List[str]] = {
    "jira": ["jira"],
    "github": ["github", "gh"],
    "slack": ["slack"],
    "google_sheets": ["google sheets", "google_sheets", "sheets", "sheet"],
    "gmail": ["gmail", "google mail", "email", "mail"],
    "aws": ["aws", "amazon web services"],
}

EXCLUSION_TERMS = ("skip", "exclude", "except", "without", "omit", "ignore")

ALL_CONNECTORS_REGEX = re.compile(
    r"all\s+(the\s+)?(connectors|integrations|services)|every\s+connector",
    re.IGNORECASE,
)

# Tool action patterns - what the user wants to do
ACTION_PATTERNS: Dict[str, List[str]] = {
    "get": [r"\bget\b", r"\bfetch\b", r"\bretrieve\b", r"\bread\b", r"\bfind\b", r"\bsearch\b", r"\blook\s*up\b"],
    "create": [r"\bcreate\b", r"\bnew\b", r"\badd\b", r"\bmake\b", r"\bgenerate\b"],
    "update": [r"\bupdate\b", r"\bmodify\b", r"\bchange\b", r"\bedit\b", r"\bset\b"],
    "delete": [r"\bdelete\b", r"\bremove\b", r"\bdestroy\b"],
    "post": [r"\bpost\b", r"\bsend\b", r"\bnotify\b", r"\bmessage\b", r"\balert\b"],
    "append": [r"\bappend\b", r"\blog\b", r"\brecord\b", r"\btrack\b"],
}

REQUIRED_API_SYSTEM_PROMPT = """
You are the Required API Agent in a workflow system.
Analyze the user's prompt and identify which services/APIs are required.

Return JSON with this exact schema:
{
  "required_services": [
    {
      "service_id": "string (jira|github|slack|google_sheets|gmail|aws)",
      "reason": "string (why this service is needed)",
      "actions": ["string (what actions are needed: get|create|update|delete|post|append)"],
      "priority": 1
    }
  ],
  "extracted_params": {
    "issue_key": "string or null",
    "repo": "string or null",
    "branch": "string or null",
    "channel": "string or null"
  },
  "workflow_summary": "string (brief description of what the workflow will do)"
}

Rules:
- Only include services that are explicitly needed based on the prompt
- Extract any parameters mentioned (issue keys, repo names, etc.)
- Priority 1 = most important, higher = less important
- Be precise - don't include services that aren't clearly needed
""".strip()


class RequiredAPIAgent(BaseAgent):
    name = "required-api-agent"

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
    ) -> RequiredAPIResult:
        """Analyze prompt to identify required services and check their connectivity."""
        
        # Try LLM first for better understanding
        if self.gemini.enabled:
            try:
                response_json = await self.gemini.generate_json(
                    REQUIRED_API_SYSTEM_PROMPT,
                    {
                        "prompt": prompt,
                        "available_services": [
                            {"id": i.id, "name": i.name, "status": i.status}
                            for i in integrations
                        ],
                    },
                )
                llm_result = self._parse_llm_response(response_json, integrations)
                return self._validate_and_enrich(llm_result, integrations, prompt)
            except Exception:
                pass

        # Fallback to heuristic detection
        heuristic_result = self._heuristic_detection(prompt, integrations)
        return self._validate_and_enrich(heuristic_result, integrations, prompt)

    def _parse_llm_response(
        self,
        response: Dict,
        integrations: List[IntegrationInput],
    ) -> RequiredAPIResult:
        """Parse LLM response into RequiredAPIResult."""
        required_services = []
        
        for svc in response.get("required_services", []):
            service_id = svc.get("service_id", "")
            integration = self._find_integration(service_id, integrations)
            
            required_services.append(
                RequiredService(
                    service_id=service_id,
                    service_name=integration.name if integration else service_id,
                    reason=svc.get("reason", "Required for workflow"),
                    actions=svc.get("actions", []),
                    priority=svc.get("priority", 1),
                    is_connected=integration.status == "connected" if integration else False,
                    is_available=integration is not None,
                )
            )
        
        return RequiredAPIResult(
            required_services=required_services,
            extracted_params=response.get("extracted_params", {}),
            workflow_summary=response.get("workflow_summary", ""),
            all_services_ready=all(s.is_connected for s in required_services),
            missing_services=[s.service_id for s in required_services if not s.is_available],
            disconnected_services=[
                s.service_id for s in required_services 
                if s.is_available and not s.is_connected
            ],
        )

    def _heuristic_detection(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
    ) -> RequiredAPIResult:
        """Detect required services using pattern matching."""
        normalized = prompt.lower()
        detected_services: List[Tuple[str, Set[str]]] = []
        
        # Detect services
        for service_id, patterns in SERVICE_PATTERNS.items():
            matched = False
            for pattern in patterns:
                if re.search(pattern, normalized, re.IGNORECASE):
                    matched = True
                    break
            
            if matched:
                # Detect actions for this service
                actions = set()
                for action, action_patterns in ACTION_PATTERNS.items():
                    for pattern in action_patterns:
                        if re.search(pattern, normalized, re.IGNORECASE):
                            actions.add(action)
                
                detected_services.append((service_id, actions or {"get"}))
        
        # Extract parameters
        extracted_params = self._extract_params(prompt)
        
        # Build required services list
        required_services = []
        priority = 1
        
        for service_id, actions in detected_services:
            integration = self._find_integration(service_id, integrations)
            
            required_services.append(
                RequiredService(
                    service_id=service_id,
                    service_name=integration.name if integration else service_id.replace("_", " ").title(),
                    reason=self._generate_reason(service_id, actions, extracted_params),
                    actions=list(actions),
                    priority=priority,
                    is_connected=integration.status == "connected" if integration else False,
                    is_available=integration is not None,
                )
            )
            priority += 1
        
        # Generate workflow summary
        workflow_summary = self._generate_workflow_summary(required_services, extracted_params)
        
        return RequiredAPIResult(
            required_services=required_services,
            extracted_params=extracted_params,
            workflow_summary=workflow_summary,
            all_services_ready=all(s.is_connected for s in required_services),
            missing_services=[s.service_id for s in required_services if not s.is_available],
            disconnected_services=[
                s.service_id for s in required_services 
                if s.is_available and not s.is_connected
            ],
        )

    def _has_all_connectors_directive(self, prompt: str) -> bool:
        return bool(ALL_CONNECTORS_REGEX.search(prompt.lower().strip()))

    def _is_connector_status_query(self, prompt: str) -> bool:
        normalized = prompt.lower().strip()
        scope_terms = ("connector", "connectors", "integration", "integrations", "services")
        check_terms = (
            "connect",
            "status",
            "readiness",
            "ready",
            "available",
            "api key",
            "apikey",
            "credential",
        )
        return any(term in normalized for term in scope_terms) and any(
            term in normalized for term in check_terms
        )

    def _extract_excluded_services(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
    ) -> Set[str]:
        normalized = prompt.lower().strip()
        if not any(term in normalized for term in EXCLUSION_TERMS):
            return set()

        exclusion_pattern = "|".join(EXCLUSION_TERMS)
        excluded: Set[str] = set()

        for integration in integrations:
            aliases = {
                integration.id,
                integration.id.replace("_", " "),
                integration.name.lower(),
                *SERVICE_ALIASES.get(integration.id, []),
            }

            for alias in aliases:
                escaped_alias = re.escape(alias)
                exclude_then_alias = re.search(
                    rf"\b(?:{exclusion_pattern})\b[^.\n,;:]*\b{escaped_alias}\b",
                    normalized,
                )
                alias_then_exclude = re.search(
                    rf"\b{escaped_alias}\b[^.\n,;:]*\b(?:{exclusion_pattern})\b",
                    normalized,
                )

                if exclude_then_alias or alias_then_exclude:
                    excluded.add(integration.id)
                    break

        return excluded

    def _extract_explicit_services(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
        excluded_ids: Set[str],
    ) -> List[str]:
        normalized = prompt.lower().strip()
        explicit: Set[str] = set()

        for integration in integrations:
            if integration.id in excluded_ids:
                continue

            aliases = {
                integration.id,
                integration.id.replace("_", " "),
                integration.name.lower(),
                *SERVICE_ALIASES.get(integration.id, []),
            }

            for alias in aliases:
                if re.search(rf"\b{re.escape(alias)}\b", normalized):
                    explicit.add(integration.id)
                    break

        return [
            integration.id
            for integration in integrations
            if integration.id in explicit and integration.id not in excluded_ids
        ]

    def _infer_actions_from_prompt(self, prompt: str) -> List[str]:
        normalized = prompt.lower().strip()
        actions: List[str] = []
        for action, patterns in ACTION_PATTERNS.items():
            if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in patterns):
                actions.append(action)
        return actions or ["get"]

    def _extract_params(self, prompt: str) -> Dict[str, str]:
        """Extract common parameters from the prompt."""
        params = {}
        
        # Extract Jira issue key (e.g., ABC-123)
        issue_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        if issue_match:
            params["issue_key"] = issue_match.group(1)
        
        # Extract repository name
        repo_match = re.search(r"\brepo(?:sitory)?\s+([a-zA-Z0-9._/-]+)\b", prompt, re.IGNORECASE)
        if repo_match:
            params["repo"] = repo_match.group(1)
        
        # Extract branch name
        branch_match = re.search(r"\bbranch\s+([a-zA-Z0-9._/-]+)\b", prompt, re.IGNORECASE)
        if branch_match:
            params["branch"] = branch_match.group(1)
        
        # Extract channel name
        channel_match = re.search(r"#([a-zA-Z0-9_-]+)\b", prompt)
        if channel_match:
            params["channel"] = channel_match.group(1)
        
        return params

    def _find_integration(
        self,
        service_id: str,
        integrations: List[IntegrationInput],
    ) -> IntegrationInput | None:
        """Find integration by service ID."""
        for integration in integrations:
            if integration.id == service_id or integration.id == f"int-{service_id}":
                return integration
        return None

    def _generate_reason(
        self,
        service_id: str,
        actions: Set[str],
        params: Dict[str, str],
    ) -> str:
        """Generate a reason for why this service is needed."""
        action_str = ", ".join(sorted(actions))
        
        reasons = {
            "jira": f"To {action_str} Jira issue" + (f" {params.get('issue_key', '')}" if params.get('issue_key') else ""),
            "github": f"To {action_str} in GitHub" + (f" repository {params.get('repo', '')}" if params.get('repo') else ""),
            "slack": f"To {action_str} Slack message/notification",
            "google_sheets": f"To {action_str} spreadsheet data",
            "gmail": f"To {action_str} email",
            "aws": f"To {action_str} AWS resources",
        }
        
        return reasons.get(service_id, f"To {action_str} via {service_id}")

    def _generate_workflow_summary(
        self,
        services: List[RequiredService],
        params: Dict[str, str],
    ) -> str:
        """Generate a brief workflow summary."""
        if not services:
            return "No specific services detected"
        
        service_names = [s.service_name for s in services]
        
        if params.get("issue_key"):
            return f"Workflow for {params['issue_key']} using {', '.join(service_names)}"
        
        return f"Workflow using {', '.join(service_names)}"

    def _validate_and_enrich(
        self,
        result: RequiredAPIResult,
        integrations: List[IntegrationInput],
        prompt: str,
    ) -> RequiredAPIResult:
        """Validate and enrich the result with connectivity info."""
        heuristic_result = self._heuristic_detection(prompt, integrations)
        excluded_ids = self._extract_excluded_services(prompt, integrations)
        explicit_ids = self._extract_explicit_services(prompt, integrations, excluded_ids)
        include_all = self._has_all_connectors_directive(prompt)
        connector_status_query = self._is_connector_status_query(prompt)

        available_ids_in_order = [integration.id for integration in integrations]
        available_id_set = set(available_ids_in_order)

        existing_map = {
            service.service_id: service
            for service in result.required_services
            if service.service_id in available_id_set
        }

        for service in heuristic_result.required_services:
            if service.service_id not in available_id_set:
                continue
            if service.service_id not in existing_map:
                existing_map[service.service_id] = service

        if include_all or (connector_status_query and not explicit_ids):
            required_ids = [
                integration.id
                for integration in integrations
                if integration.id not in excluded_ids
            ]
        else:
            required_ids = [
                service_id
                for service_id in available_ids_in_order
                if service_id in existing_map and service_id not in excluded_ids
            ]

            if explicit_ids:
                for service_id in explicit_ids:
                    if service_id not in required_ids and service_id not in excluded_ids:
                        required_ids.append(service_id)

        inferred_actions = self._infer_actions_from_prompt(prompt)

        required_services: List[RequiredService] = []
        for priority, service_id in enumerate(required_ids, start=1):
            integration = self._find_integration(service_id, integrations)
            existing = existing_map.get(service_id)

            if existing and existing.reason:
                reason = existing.reason
            elif include_all:
                reason = "Required by all-connectors request"
            elif connector_status_query:
                reason = "Required for connector readiness check"
            else:
                reason = "Required to fulfill the prompt"

            actions = existing.actions if existing and existing.actions else inferred_actions

            required_services.append(
                RequiredService(
                    service_id=service_id,
                    service_name=(
                        integration.name
                        if integration
                        else service_id.replace("_", " ").title()
                    ),
                    reason=reason,
                    actions=actions,
                    priority=priority,
                    is_connected=integration.status == "connected" if integration else False,
                    is_available=integration is not None,
                )
            )

        result.required_services = required_services

        for key, value in heuristic_result.extracted_params.items():
            if key not in result.extracted_params and value:
                result.extracted_params[key] = value

        # Extract additional params if missing
        if not result.extracted_params:
            result.extracted_params = self._extract_params(prompt)

        if not result.workflow_summary:
            result.workflow_summary = self._generate_workflow_summary(
                result.required_services,
                result.extracted_params,
            )

        # Update aggregated fields
        result.all_services_ready = all(s.is_connected for s in result.required_services)
        result.missing_services = [
            s.service_id for s in result.required_services if not s.is_available
        ]
        result.disconnected_services = [
            s.service_id
            for s in result.required_services
            if s.is_available and not s.is_connected
        ]

        return result
