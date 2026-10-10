#!/usr/bin/env python3
import aws_cdk as cdk

from hallway_backend.stack import HallwayStack

app = cdk.App()
HallwayStack(
    app,
    "HallwayStack",
    # Bedrock model access is per region. us-east-1 has the cross-region Claude profiles.
    env=cdk.Environment(region=app.node.try_get_context("region") or "us-east-1"),
)
app.synth()
