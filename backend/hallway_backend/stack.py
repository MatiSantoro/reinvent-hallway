from datetime import datetime, timezone
from pathlib import Path

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigatewayv2 as apigw
from aws_cdk import aws_apigatewayv2_integrations as integrations
from aws_cdk import aws_dynamodb as ddb
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from constructs import Construct

LAMBDA_DIR = Path(__file__).resolve().parent.parent / "lambda"


class HallwayStack(Stack):
    """Groups + planner backend: HTTP API -> one Lambda -> DynamoDB and Bedrock."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        model_id = self.node.try_get_context("bedrockModelId")
        expires = datetime.strptime(self.node.try_get_context("expiresAt") or "2027-01-31", "%Y-%m-%d")
        expires_at = int(expires.replace(tzinfo=timezone.utc).timestamp())

        # Single-table design. TTL cleans everything up after re:Invent.
        table = ddb.TableV2(
            self,
            "Table",
            partition_key=ddb.Attribute(name="pk", type=ddb.AttributeType.STRING),
            sort_key=ddb.Attribute(name="sk", type=ddb.AttributeType.STRING),
            billing=ddb.Billing.on_demand(),
            time_to_live_attribute="expiresAt",
            removal_policy=RemovalPolicy.DESTROY,
        )

        fn = lambda_.Function(
            self,
            "Api",
            runtime=lambda_.Runtime.PYTHON_3_13,
            architecture=lambda_.Architecture.ARM_64,
            handler="handler.lambda_handler",
            code=lambda_.Code.from_asset(str(LAMBDA_DIR), exclude=["__pycache__", "*.pyc"]),
            timeout=Duration.seconds(60),  # Bedrock planning can take a while
            memory_size=512,
            environment={
                "TABLE_NAME": table.table_name,
                "BEDROCK_MODEL_ID": model_id,
                "EXPIRES_AT": str(expires_at),
            },
            log_group=logs.LogGroup(
                self, "ApiLogs", retention=logs.RetentionDays.ONE_MONTH, removal_policy=RemovalPolicy.DESTROY
            ),
        )
        table.grant_read_write_data(fn)

        # Cross-region inference profiles route to the model in several regions.
        fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=[
                    "arn:aws:bedrock:*::foundation-model/*",
                    f"arn:aws:bedrock:*:{self.account}:inference-profile/*",
                ],
            )
        )

        api = apigw.HttpApi(
            self,
            "Http",
            default_integration=integrations.HttpLambdaIntegration("Lambda", fn),
        )
        # Keep costs predictable: the /plan route calls an LLM.
        stage = api.default_stage.node.default_child
        stage.default_route_settings = apigw.CfnStage.RouteSettingsProperty(
            throttling_rate_limit=10, throttling_burst_limit=20
        )

        CfnOutput(self, "ApiUrl", value=api.api_endpoint, description="Set as EXPO_PUBLIC_BACKEND_URL in app/.env")
        CfnOutput(self, "TableName", value=table.table_name)
