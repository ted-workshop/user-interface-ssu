terraform {
  required_version = "~> 1.17.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28.1"
    }
  }
}

provider "cloudflare" {}

variable "account_id" {
  description = "Cloudflare account ID; credentials use CLOUDFLARE_API_TOKEN."
  type        = string
}

locals {
  worker = jsondecode(file("${path.module}/../../apps/api/wrangler.jsonc"))
}

resource "cloudflare_d1_database" "api" {
  account_id = var.account_id
  name       = local.worker.d1_databases[0].database_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_worker" "api" {
  account_id = var.account_id
  name       = local.worker.name
}

output "database_id" {
  value = cloudflare_d1_database.api.id
}

output "worker_name" {
  value = cloudflare_worker.api.name
}
